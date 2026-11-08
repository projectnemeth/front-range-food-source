import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  coordinatorCommandSchema,
  coordinatorReadSchema,
  type CoordinatorCommand,
  type EventConfig,
  type ImportDraft,
  type ImportRow,
  type CoordinatorView,
} from "./coordinator-contracts";
import { createFulfillmentOrder, type FulfillmentOrder } from "./model";
import { fulfillmentKey } from "./store";
import { WorkflowError } from "./workflow";

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new WorkflowError(code);
}
// Require the complete untouched state, not just an absence of boxes.
function unstarted(order: FulfillmentOrder) {
  return (
    fulfillmentKey(order) ===
    fulfillmentKey({
      ...createFulfillmentOrder(order.manifest),
      version: order.version,
    })
  );
}
export class CoordinatorStore {
  constructor(
    private readonly db: Firestore,
    private readonly clock = () => new Date().toISOString(),
  ) {}
  private event(id: string) {
    return this.db.collection("fulfillmentEvents").doc(id);
  }
  private async coordinator(tx: Transaction, eventId: string, uid: string) {
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
    return config.data() as EventConfig;
  }
  async read(uid: string, input: unknown): Promise<CoordinatorView> {
    const { eventId } = coordinatorReadSchema.parse(input);
    return this.db.runTransaction(async (tx) => {
      const event = await this.coordinator(tx, eventId, uid);
      const staff = await tx.get(
        this.event(eventId).collection("staff").limit(201),
      );
      const locations = await tx.get(
        this.event(eventId).collection("locations").limit(201),
      );
      check(staff.size <= 200 && locations.size <= 200, "setupLimitExceeded");
      return {
        event: {
          id: eventId,
          label: event.label,
          pickupDate: event.pickupDate,
          enabled: event.enabled,
          status: event.status,
          version: event.version,
          sourceScope: event.sourceScope,
          mappingVersion: event.mappingVersion,
        },
        staff: staff.docs.map((doc) => ({
          uid: doc.id,
          role: doc.data().role,
          active: doc.data().active,
        })),
        locations: locations.docs.map((doc) => ({
          code: doc.data().code,
          capacity: doc.data().capacity,
          count: doc.data().count,
          active: doc.data().active,
        })),
      };
    });
  }
  async execute(uid: string, input: unknown) {
    const command = coordinatorCommandSchema.parse(input);
    if (command.action === "preview") return this.preview(uid, command);
    if (command.action === "apply") return this.apply(uid, command);
    const event = this.event(command.eventId);
    const receipt = event
      .collection("setupOperations")
      .doc(fulfillmentKey([uid, command.operationId]));
    const fingerprint = fulfillmentKey(command);
    const now = this.clock();
    return this.db.runTransaction(async (tx) => {
      if (command.action === "createEvent") {
        const [admin, existing, prior] = await tx.getAll(
          this.db.collection("users").doc(uid),
          event,
          receipt,
        );
        check(admin.data()?.role === "ADMIN", "forbidden");
        if (prior.exists) {
          check(prior.data()!.fingerprint === fingerprint, "operationConflict");
          return { eventId: command.eventId, replayed: true };
        }
        check(!existing.exists, "eventExists");
        tx.create(event, {
          id: command.eventId,
          label: command.label,
          pickupDate: command.pickupDate,
          sourceScope: command.sourceScope,
          mappingVersion: command.mappingVersion,
          version: 0,
          enabled: false,
          status: "CLOSED",
        });
        tx.create(event.collection("staff").doc(uid), {
          role: "coordinator",
          active: true,
        });
      } else {
        const config = await this.coordinator(tx, command.eventId, uid);
        const prior = await tx.get(receipt);
        if (prior.exists) {
          check(prior.data()!.fingerprint === fingerprint, "operationConflict");
          return { eventId: command.eventId, replayed: true };
        }
        check(config.version === command.expectedVersion, "staleVersion");
        if (command.action === "staff") {
          const ref = event.collection("staff").doc(command.uid);
          const [existing, grants] = await Promise.all([
            tx.get(ref),
            tx.get(event.collection("staff").limit(201)),
          ]);
          check(
            existing.data()?.role !== "coordinator",
            "coordinatorProtected",
          );
          check(existing.exists || grants.size < 200, "setupLimitExceeded");
          tx.set(ref, { role: command.role, active: command.active });
        } else if (command.action === "location") {
          const ref = event
            .collection("locations")
            .doc(fulfillmentKey(command.code));
          const [existing, locations] = await Promise.all([
            tx.get(ref),
            tx.get(event.collection("locations").limit(201)),
          ]);
          check(existing.exists || locations.size < 200, "setupLimitExceeded");
          const count = existing.data()?.count ?? 0;
          check(Number.isInteger(count) && count >= 0, "invalidLocation");
          check(
            command.capacity >= count && (command.active || count === 0),
            "locationOccupied",
          );
          tx.set(ref, {
            code: command.code,
            capacity: command.capacity,
            active: command.active,
            count,
            orderId: existing.data()?.orderId ?? null,
          });
        } else if (command.enabled) {
          const locations = await tx.get(
            event.collection("locations").where("active", "==", true).limit(1),
          );
          check(!locations.empty, "locationRequired");
        }
        tx.update(event, {
          version: config.version + 1,
          ...(command.action === "setEnabled"
            ? {
                enabled: command.enabled,
                status: command.enabled ? "OPEN" : "CLOSED",
              }
            : {}),
        });
      }
      tx.create(receipt, {
        fingerprint,
        actor: uid,
        at: now,
        action: command.action,
      });
      tx.create(
        event
          .collection("activity")
          .doc(fulfillmentKey([uid, command.operationId])),
        { actor: uid, at: now, command },
      );
      return { eventId: command.eventId, replayed: false };
    });
  }

  private async preview(
    uid: string,
    command: Extract<CoordinatorCommand, { action: "preview" }>,
  ): Promise<{ draft: ImportDraft }> {
    const event = this.event(command.eventId);
    const draftRef = event.collection("importDrafts").doc(command.operationId);
    const fingerprint = fulfillmentKey(command);
    const now = this.clock();
    return this.db.runTransaction(async (tx) => {
      const config = await this.coordinator(tx, command.eventId, uid);
      const prior = await tx.get(draftRef);
      if (prior.exists) {
        check(
          prior.data()!.fingerprint === fingerprint &&
            prior.data()!.actor === uid,
          "operationConflict",
        );
        return { draft: prior.data() as ImportDraft };
      }
      const sourceRefs = command.manifests.map((manifest) =>
        event
          .collection("sources")
          .doc(fulfillmentKey([manifest.source.kind, manifest.source.key])),
      );
      const sources = await tx.getAll(...sourceRefs);
      const manifests = command.manifests.map((manifest, i) => ({
        ...manifest,
        id:
          sources[i].data()?.orderId ??
          `F_${fulfillmentKey([command.eventId, manifest.source.kind, manifest.source.key]).slice(0, 32)}`,
      }));
      const orders = await tx.getAll(
        ...manifests.map((manifest) =>
          this.db.collection("fulfillmentOrders").doc(manifest.id),
        ),
      );
      const rows: ImportRow[] = manifests.map((manifest, i) => {
        let reason = "";
        if (manifest.eventId !== command.eventId) reason = "Wrong pickup event";
        else if (
          manifest.source.kind !== "googleSheet" ||
          !manifest.source.key.startsWith(`${config.sourceScope}/`) ||
          manifest.source.key.length <= config.sourceScope.length + 1
        )
          reason = "Source does not match this event";
        else if (manifest.mappingVersion !== config.mappingVersion)
          reason = "Mapping version does not match this event";
        else if (
          sourceRefs.filter((ref) => ref.path === sourceRefs[i].path).length > 1
        )
          reason = "Duplicate source identity in this preview";
        else if (sources[i].exists !== orders[i].exists)
          reason = "Source identity requires reconciliation";
        const previous = orders[i].data() as FulfillmentOrder | undefined;
        if (
          !reason &&
          previous &&
          (previous.manifest?.eventId !== command.eventId ||
            previous.manifest?.id !== manifest.id ||
            previous.manifest?.source.kind !== manifest.source.kind ||
            previous.manifest?.source.key !== manifest.source.key)
        )
          reason = "Source identity requires reconciliation";
        const changed =
          previous &&
          fulfillmentKey(previous.manifest) !== fulfillmentKey(manifest);
        if (!reason && changed && !unstarted(previous))
          reason =
            "Existing work has started or is on hold; preserve it and reconcile separately";
        return {
          manifest,
          status: reason
            ? "blocked"
            : changed
              ? "update"
              : orders[i].exists
                ? "unchanged"
                : "new",
          reason:
            reason ||
            (changed ? "Replaces an unstarted order after review" : ""),
          ...(!reason && changed
            ? {
                previousManifest: previous.manifest,
                previousFingerprint: fulfillmentKey(previous),
              }
            : {}),
        };
      });
      const draft: ImportDraft = {
        id: command.operationId,
        eventId: command.eventId,
        actor: uid,
        eventVersion: config.version,
        fingerprint,
        expiresAt: new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
        appliedAt: null,
        rows,
      };
      tx.create(draftRef, draft);
      return { draft };
    });
  }
  private async apply(
    uid: string,
    command: Extract<CoordinatorCommand, { action: "apply" }>,
  ) {
    const event = this.event(command.eventId);
    const draftRef = event.collection("importDrafts").doc(command.draftId);
    const now = this.clock();
    return this.db.runTransaction(async (tx) => {
      const config = await this.coordinator(tx, command.eventId, uid);
      const snapshot = await tx.get(draftRef);
      check(snapshot.exists && snapshot.data()!.actor === uid, "draftNotFound");
      const draft = snapshot.data() as ImportDraft;
      if (draft.appliedAt)
        return {
          applied: true,
          replayed: true,
          count: draft.rows.filter((row) => row.status === "new").length,
          updated: draft.rows.filter((row) => row.status === "update").length,
        };
      check(Date.parse(draft.expiresAt) > Date.parse(now), "draftExpired");
      check(draft.eventVersion === config.version, "stalePreview");
      check(
        draft.rows.every((row) => row.status !== "blocked"),
        "previewBlocked",
      );
      const refs = draft.rows.map((row) =>
        this.db.collection("fulfillmentOrders").doc(row.manifest.id),
      );
      const sourceRefs = draft.rows.map((row) =>
        event
          .collection("sources")
          .doc(
            fulfillmentKey([row.manifest.source.kind, row.manifest.source.key]),
          ),
      );
      const records = await tx.getAll(...refs, ...sourceRefs);
      for (const [index, row] of draft.rows.entries()) {
        const existing = records[index],
          source = records[index + refs.length];
        if (row.status === "new")
          check(!existing.exists && !source.exists, "stalePreview");
        else if (row.status === "update") {
          check(
            existing.exists &&
              source.data()?.orderId === row.manifest.id &&
              fulfillmentKey(existing.data()) === row.previousFingerprint &&
              unstarted(existing.data() as FulfillmentOrder),
            "stalePreview",
          );
        } else
          check(
            existing.exists &&
              source.data()?.orderId === row.manifest.id &&
              fulfillmentKey(existing.data()!.manifest) ===
                fulfillmentKey(row.manifest),
            "stalePreview",
          );
      }
      for (const [index, row] of draft.rows.entries())
        if (row.status === "new") {
          tx.create(refs[index], createFulfillmentOrder(row.manifest));
          tx.create(sourceRefs[index], {
            orderId: row.manifest.id,
            source: row.manifest.source,
          });
          tx.create(
            refs[index].collection("activity").doc(`import-${command.draftId}`),
            {
              type: "import",
              actor: uid,
              at: now,
              version: 0,
              draftId: command.draftId,
            },
          );
        }
      for (const [index, row] of draft.rows.entries()) {
        if (row.status !== "update") continue;
        const version = records[index].data()!.version + 1;
        tx.set(refs[index], {
          ...createFulfillmentOrder(row.manifest),
          version,
        });
        tx.update(sourceRefs[index], { source: row.manifest.source });
        tx.create(
          refs[index].collection("activity").doc(`import-${command.draftId}`),
          {
            type: "sourceUpdate",
            actor: uid,
            at: now,
            version,
            draftId: command.draftId,
            previousManifest: row.previousManifest,
            manifest: row.manifest,
          },
        );
      }
      tx.update(draftRef, { appliedAt: now });
      tx.create(event.collection("activity").doc(`import-${command.draftId}`), {
        type: "import",
        actor: uid,
        at: now,
        draftId: command.draftId,
        count: draft.rows.filter((row) => row.status === "new").length,
        updated: draft.rows.filter((row) => row.status === "update").length,
      });
      return {
        applied: true,
        replayed: false,
        count: draft.rows.filter((row) => row.status === "new").length,
        updated: draft.rows.filter((row) => row.status === "update").length,
      };
    });
  }
}
