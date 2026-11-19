import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { FulfillmentOrder, PackingAllocation } from "./model";
import { fulfillmentKey } from "./store";
import { WorkflowError } from "./workflow";
import {
  restartedOrder,
  selectionTiming,
  itemIdentity,
  type ReconciliationAddition,
  type ReconciliationCommand,
  type ReconciliationReview,
  type ReconciliationPreview,
  type ReconciliationView,
} from "./reconciliation";
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new WorkflowError(code);
}

export class ReconciliationStore {
  constructor(
    private db: Firestore,
    private clock = () => new Date().toISOString(),
  ) {}
  private event(id: string) {
    return this.db.collection("fulfillmentEvents").doc(id);
  }
  private async authorize(tx: Transaction, eventId: string, uid: string) {
    const event = this.event(eventId);
    const [config, grant] = await tx.getAll(
      event,
      event.collection("staff").doc(uid),
    );
    check(
      config.exists &&
        grant.data()?.active === true &&
        grant.data()?.role === "coordinator",
      "forbidden",
    );
    return config.data()!;
  }
  private eligible(order: FulfillmentOrder) {
    check(
      !order.deliveredAt && !["cancelled", "departed"].includes(order.control),
      "reconciliationTerminal",
    );
    check(
      order.packages.every((p) => !p.custody && !p.handedOver),
      "reconciliationCustody",
    );
  }
  async execute(uid: string, command: ReconciliationCommand) {
    const event = this.event(command.eventId),
      now = this.clock();
    const fingerprint = fulfillmentKey(command);
    return this.db.runTransaction(async (tx) => {
      const config = await this.authorize(tx, command.eventId, uid);
      if (
        command.action === "reconciliationRead" ||
        command.action === "reconciliationStart"
      ) {
        const ref = this.db
          .collection("fulfillmentOrders")
          .doc(command.orderId);
        const snap = await tx.get(ref);
        check(
          snap.exists && snap.data()!.manifest.eventId === command.eventId,
          "orderNotFound",
        );
        const order = snap.data() as FulfillmentOrder;
        if (command.action === "reconciliationRead") {
          const review = order.reconciliationId
            ? await tx.get(
                event.collection("reconciliations").doc(order.reconciliationId),
              )
            : null;
          return {
            reconciliation: {
              order,
              review: review?.exists
                ? (review.data() as ReconciliationReview)
                : null,
            } satisfies ReconciliationView,
          };
        }
        const reviewRef = event
          .collection("reconciliations")
          .doc(command.operationId);
        const prior = await tx.get(reviewRef);
        if (prior.exists) {
          check(
            prior.data()!.startFingerprint === fingerprint &&
              prior.data()!.actor === uid,
            "operationConflict",
          );
          return {
            reconciliation: {
              order,
              review: prior.data() as ReconciliationReview,
            } satisfies ReconciliationView,
          };
        }
        check(order.version === command.expectedVersion, "staleVersion");
        check(!order.reconciliationId, "reconciliationPending");
        this.eligible(order);
        const active = await tx.get(
          event
            .collection("reconciliations")
            .where("status", "==", "open")
            .limit(200),
        );
        check(active.size < 200, "setupLimitExceeded");
        const review: ReconciliationReview = {
          id: reviewRef.id,
          eventId: command.eventId,
          orderId: command.orderId,
          household: order.manifest.householdLabel,
          actor: uid,
          reason: command.reason,
          startedAt: now,
          status: "open",
          before: order,
          startFingerprint: fingerprint,
        };
        const held: FulfillmentOrder = {
          ...order,
          control: "held",
          reason: command.reason,
          reconciliationId: review.id,
          version: order.version + 1,
        };
        tx.create(reviewRef, review);
        tx.set(ref, held);
        tx.create(
          ref.collection("activity").doc(`reconciliation-start-${review.id}`),
          {
            type: "reconciliationStarted",
            reviewId: review.id,
            actor: uid,
            at: now,
            version: held.version,
            reason: command.reason,
          },
        );
        return {
          reconciliation: { order: held, review } satisfies ReconciliationView,
        };
      }
      const previewRef =
        command.action === "reconciliationApply"
          ? event.collection("reconciliationPreviews").doc(command.previewId)
          : null;
      const previewSnap = previewRef ? await tx.get(previewRef) : null;
      const preview = previewSnap?.data() as ReconciliationPreview | undefined;
      if (command.action === "reconciliationApply")
        check(preview && preview.actor === uid, "draftNotFound");
      const reviewId =
        command.action === "reconciliationApply"
          ? preview!.reviewId
          : command.reviewId;
      const reviewRef = event.collection("reconciliations").doc(reviewId);
      const reviewSnap = await tx.get(reviewRef);
      check(reviewSnap.exists, "draftNotFound");
      const review = reviewSnap.data() as ReconciliationReview;
      const ref = this.db.collection("fulfillmentOrders").doc(review.orderId);
      const snap = await tx.get(ref);
      check(
        snap.exists && snap.data()!.manifest.eventId === command.eventId,
        "orderNotFound",
      );
      const current = snap.data() as FulfillmentOrder;
      if (command.action === "reconciliationApply" && preview!.appliedAt) {
        check(preview!.applyFingerprint === fingerprint, "operationConflict");
        return {
          reconciliation: {
            order: current,
            review,
          } satisfies ReconciliationView,
          reconciliationFinished: true,
          replayed: true,
        };
      }
      if (
        command.action === "reconciliationCancel" &&
        review.status === "cancelled"
      ) {
        check(review.finishFingerprint === fingerprint, "operationConflict");
        return {
          reconciliation: {
            order: current,
            review,
          } satisfies ReconciliationView,
          reconciliationFinished: true,
          replayed: true,
        };
      }
      check(
        review.status === "open" &&
          current.reconciliationId === review.id &&
          current.control === "held",
        "reconciliationClosed",
      );
      this.eligible(current);
      if (command.action === "reconciliationCancel") {
        check(current.version === command.expectedVersion, "staleVersion");
        const next = {
          ...current,
          control: review.before.control,
          reason: review.before.reason,
          version: current.version + 1,
        };
        delete next.reconciliationId;
        if (
          next.control === "active" &&
          next.arrival &&
          next.portions.afterArrival.state === "waiting"
        )
          next.portions.afterArrival.state = "queued";
        const finished = {
          ...review,
          status: "cancelled" as const,
          finishedAt: now,
          finishFingerprint: fingerprint,
        };
        tx.set(ref, next);
        tx.set(reviewRef, finished);
        tx.create(
          ref.collection("activity").doc(`reconciliation-cancel-${review.id}`),
          {
            type: "reconciliationCancelled",
            actor: uid,
            at: now,
            version: next.version,
            reason: command.reason,
            goodsUnchanged: true,
          },
        );
        return {
          reconciliation: {
            order: next,
            review: finished,
          } satisfies ReconciliationView,
          reconciliationFinished: true,
          replayed: false,
        };
      }
      if (command.action === "reconciliationPreview") {
        const draftRef = event
          .collection("reconciliationPreviews")
          .doc(command.operationId);
        const prior = await tx.get(draftRef);
        if (prior.exists) {
          check(
            prior.data()!.fingerprint === fingerprint &&
              prior.data()!.actor === uid,
            "operationConflict",
          );
          return {
            reconciliationPreview: prior.data() as ReconciliationPreview,
          };
        }
        const proposed = command.manifest,
          original = current.manifest;
        check(
          proposed.id === original.id &&
            proposed.eventId === original.eventId &&
            proposed.source.kind === original.source.kind &&
            proposed.source.key === original.source.key &&
            proposed.mappingVersion === config.mappingVersion,
          "reconciliationIdentity",
        );
        check(
          original.lines.every((old) =>
            proposed.lines.some((line) => line.id === old.id),
          ),
          "reconciliationMapping",
        );
        for (const oldLine of original.lines) {
          const line = proposed.lines.find((l) => l.id === oldLine.id);
          if (line)
            check(
              line.item === oldLine.item &&
                line.unit === oldLine.unit &&
                line.stage === oldLine.stage &&
                line.storage === oldLine.storage,
              "reconciliationMapping",
            );
        }
        for (const lineId of Object.keys(current.allocations ?? {})) {
          const line = proposed.lines.find((l) => l.id === lineId);
          const previous = original.lines.find((l) => l.id === lineId)!;
          check(
            line && line.quantity === previous.quantity,
            "reconciliationAllocatedLine",
          );
        }
        const newLines = proposed.lines.filter(
          (line) => !original.lines.some((old) => old.id === line.id),
        );
        check(
          command.additions.length === newLines.length &&
            new Set(command.additions.map((a) => a.lineId)).size ===
              newLines.length &&
            command.additions.every((a) =>
              newLines.some((line) => line.id === a.lineId),
            ),
          "reconciliationSelections",
        );
        const catalog = newLines.length
          ? await tx.get(event.collection("allocationItems").limit(201))
          : null;
        check(!catalog || catalog.size <= 200, "setupLimitExceeded");
        const householdKey =
          Object.values(current.allocations ?? {})[0]?.householdKey ??
          original.source.key;
        const additions: ReconciliationAddition[] = command.additions.map(
          (a) => {
            const line = newLines.find((line) => line.id === a.lineId)!;
            const timing = selectionTiming(a.category);
            check(
              line.stage === timing.stage && line.storage === timing.storage,
              "reconciliationSelectionTiming",
            );
            check(
              proposed.lines.filter(
                (other) => itemIdentity(other.item) === itemIdentity(line.item),
              ).length === 1,
              "reconciliationDuplicateItem",
            );
            const matches = catalog!.docs.filter(
              (doc) =>
                itemIdentity(doc.data().item) === itemIdentity(line.item),
            );
            check(matches.length <= 1, "reconciliationSelectionBudget");
            if (!matches.length) return { ...a, budget: null };
            const item = matches[0].data();
            check(
              itemIdentity(item.unit) === itemIdentity(line.unit) &&
                item.packingPlanId &&
                a.available !== undefined,
              "reconciliationSelectionBudget",
            );
            check(
              !Object.values(current.allocations ?? {}).some(
                (old) => old.itemId === matches[0].id,
              ),
              "reconciliationDuplicateItem",
            );
            check(
              item.allocated + line.quantity <= a.available,
              "allocationOverStock",
            );
            return {
              ...a,
              budget: {
                itemId: matches[0].id,
                planId: item.packingPlanId,
                householdKey,
                itemVersion: item.version,
                previousAvailable: item.available,
                previousAllocated: item.allocated,
                available: a.available,
                quantity: line.quantity,
              },
            };
          },
        );
        if (additions.some((a) => a.budget)) {
          const binding = await tx.get(
            event
              .collection("allocationHouseholds")
              .doc(fulfillmentKey(householdKey)),
          );
          check(
            !binding.exists || binding.data()!.orderId === original.id,
            "packingHouseholdMismatch",
          );
        }
        check(
          new Set(command.adjustments.map((a) => a.lineId)).size ===
            command.adjustments.length,
          "reconciliationAdjustment",
        );
        const allocations = command.adjustments.map((a) =>
          current.allocations && Object.hasOwn(current.allocations, a.lineId)
            ? current.allocations[a.lineId]
            : undefined,
        );
        check(allocations.every(Boolean), "reconciliationAdjustment");
        check(
          new Set(allocations.map((a) => a!.itemId)).size ===
            allocations.length,
          "reconciliationAdjustment",
        );
        const items = allocations.length
          ? await tx.getAll(
              ...allocations.map((a) =>
                event.collection("allocationItems").doc(a!.itemId),
              ),
            )
          : [];
        const adjustments = command.adjustments.map((a, i) => {
          const allocation = allocations[i]!,
            item = items[i].data();
          check(
            item && item.packingPlanId === allocation.planId,
            "staleAllocation",
          );
          check(
            Number.isInteger(item.allocated) &&
              item.allocated >= allocation.quantity,
            "reconciliationStock",
          );
          check(
            item.allocated - allocation.quantity + a.quantity <= a.available,
            "allocationOverStock",
          );
          return {
            ...a,
            itemId: allocation.itemId,
            itemVersion: item.version,
            previousQuantity: allocation.quantity,
            previousAvailable: item.available,
            previousAllocated: item.allocated,
          };
        });
        check(
          fulfillmentKey(proposed) !== fulfillmentKey(original) ||
            adjustments.some(
              (a) =>
                a.quantity !== a.previousQuantity ||
                a.available !== a.previousAvailable,
            ),
          "reconciliationNoChange",
        );
        const draft: ReconciliationPreview = {
          id: draftRef.id,
          eventId: command.eventId,
          reviewId: review.id,
          actor: uid,
          eventVersion: config.version,
          orderFingerprint: fulfillmentKey(current),
          fingerprint,
          expiresAt: new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
          manifest: proposed,
          additions,
          adjustments,
          appliedAt: null,
        };
        tx.create(draftRef, draft);
        return { reconciliationPreview: draft };
      }
      check(preview && previewRef, "draftNotFound");
      check(Date.parse(preview.expiresAt) > Date.parse(now), "draftExpired");
      check(
        preview.eventVersion === config.version &&
          preview.orderFingerprint === fulfillmentKey(current),
        "stalePreview",
      );
      check(
        command.packages.length === current.packages.length &&
          new Set(command.packages.map((p) => p.id)).size ===
            command.packages.length &&
          command.packages.every((p) =>
            current.packages.some((old) => old.id === p.id),
          ),
        "reconciliationPackages",
      );
      const sourceRef = event
        .collection("sources")
        .doc(
          fulfillmentKey([
            current.manifest.source.kind,
            current.manifest.source.key,
          ]),
        );
      const source = await tx.get(sourceRef);
      check(
        source.data()?.orderId === current.manifest.id,
        "reconciliationIdentity",
      );
      const counts = new Map<string, number>();
      for (const pkg of current.packages)
        counts.set(pkg.location, (counts.get(pkg.location) ?? 0) + 1);
      const locations = [...counts.keys()].map((code) =>
        event.collection("locations").doc(fulfillmentKey(code)),
      );
      const locationDocs = locations.length
        ? await tx.getAll(...locations)
        : [];
      locationDocs.forEach((doc, i) => {
        const code = [...counts.keys()][i];
        check(
          doc.data()?.code === code &&
            doc.data()?.orderId === current.manifest.id &&
            doc.data()?.count === counts.get(code),
          "locationCountConflict",
        );
      });
      const itemRefs = preview.adjustments.map((a) =>
        event.collection("allocationItems").doc(a.itemId),
      );
      const items = itemRefs.length ? await tx.getAll(...itemRefs) : [];
      const additions = preview.additions ?? [];
      const addedBudgets = additions.flatMap((a) =>
        a.budget ? [{ ...a.budget, lineId: a.lineId }] : [],
      );
      // Recheck the catalogue even for manually reviewed items: a newly created plan must not be bypassed.
      const catalog = additions.length
        ? await tx.get(event.collection("allocationItems").limit(201))
        : null;
      check(!catalog || catalog.size <= 200, "setupLimitExceeded");
      for (const a of additions) {
        const line = preview.manifest.lines.find(
          (line) => line.id === a.lineId,
        )!;
        const matches = catalog!.docs.filter(
          (doc) => itemIdentity(doc.data().item) === itemIdentity(line.item),
        );
        check(
          a.budget
            ? matches.length === 1 && matches[0].id === a.budget.itemId
            : matches.length === 0,
          "staleAllocation",
        );
        if (a.budget) {
          const item = matches[0].data(),
            b = a.budget;
          check(
            item.version === b.itemVersion &&
              item.allocated === b.previousAllocated &&
              item.available === b.previousAvailable &&
              item.packingPlanId === b.planId &&
              itemIdentity(item.unit) === itemIdentity(line.unit),
            "staleAllocation",
          );
          check(
            item.allocated + b.quantity <= b.available,
            "allocationOverStock",
          );
        }
      }
      const householdKeys = [
        ...new Set(addedBudgets.map((b) => b.householdKey)),
      ];
      const bindingRefs = householdKeys.map((key) =>
        event.collection("allocationHouseholds").doc(fulfillmentKey(key)),
      );
      const bindings = bindingRefs.length
        ? await tx.getAll(...bindingRefs)
        : [];
      bindings.forEach((binding) =>
        check(
          !binding.exists || binding.data()!.orderId === current.manifest.id,
          "packingHouseholdMismatch",
        ),
      );
      const allocations = current.allocations
        ? structuredClone(current.allocations)
        : addedBudgets.length
          ? {}
          : undefined;
      for (const b of addedBudgets)
        allocations![b.lineId] = {
          planId: b.planId,
          itemId: b.itemId,
          householdKey: b.householdKey,
          quantity: b.quantity,
          reconciliationId: review.id,
          approvedBy: uid,
          appliedBy: uid,
          appliedAt: now,
        };
      preview.adjustments.forEach((a, i) => {
        const item = items[i].data();
        check(
          item?.version === a.itemVersion &&
            item.allocated === a.previousAllocated &&
            item.available === a.previousAvailable &&
            item.packingPlanId === allocations![a.lineId].planId,
          "staleAllocation",
        );
        check(
          item.allocated - a.previousQuantity + a.quantity <= a.available,
          "allocationOverStock",
        );
        allocations![a.lineId] = {
          ...allocations![a.lineId],
          quantity: a.quantity,
          reconciliationId: review.id,
          approvedBy: uid,
          appliedBy: uid,
          appliedAt: now,
        } as PackingAllocation;
      });
      const next = restartedOrder(current, preview.manifest, allocations);
      const finished = {
        ...review,
        status: "applied" as const,
        finishedAt: now,
        finishFingerprint: fingerprint,
      };
      bindingRefs.forEach((binding, i) => {
        if (!bindings[i].exists)
          tx.create(binding, {
            householdKey: householdKeys[i],
            orderId: current.manifest.id,
          });
      });
      addedBudgets.forEach((b) =>
        tx.update(event.collection("allocationItems").doc(b.itemId), {
          available: b.available,
          allocated: b.previousAllocated + b.quantity,
          version: b.itemVersion + 1,
          reconciledAt: now,
          reconciliationId: review.id,
        }),
      );
      tx.set(ref, next);
      tx.set(reviewRef, finished);
      tx.update(previewRef, { appliedAt: now, applyFingerprint: fingerprint });
      tx.update(sourceRef, { source: preview.manifest.source });
      locations.forEach((location) =>
        tx.update(location, { count: 0, orderId: null }),
      );
      itemRefs.forEach((item, i) => {
        const a = preview.adjustments[i];
        tx.update(item, {
          available: a.available,
          allocated: a.previousAllocated - a.previousQuantity + a.quantity,
          version: a.itemVersion + 1,
          reconciledAt: now,
          reconciliationId: review.id,
        });
      });
      tx.create(
        ref.collection("activity").doc(`reconciliation-apply-${review.id}`),
        {
          type: "reconciliationApplied",
          actor: uid,
          at: now,
          version: next.version,
          previewId: preview.id,
          previous: current,
          manifest: next.manifest,
          adjustments: preview.adjustments,
          additions,
          packages: command.packages,
          workNote: command.workNote,
          goodsAccountedFor: true,
          stagingCleared: true,
        },
      );
      tx.create(
        event.collection("activity").doc(`reconciliation-apply-${review.id}`),
        {
          type: "reconciliationApplied",
          actor: uid,
          at: now,
          orderId: review.orderId,
          reviewId: review.id,
        },
      );
      return {
        reconciliation: {
          order: next,
          review: finished,
        } satisfies ReconciliationView,
        reconciliationFinished: true,
        replayed: false,
      };
    });
  }
}
