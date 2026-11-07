import { createHash } from "node:crypto";
import {
  FieldPath,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  dryDetail,
  drySummary,
  type DryLocation,
  type DryResponse,
} from "./views";
import { z } from "zod";
import {
  commandSchema,
  createFulfillmentOrder,
  type Actor,
  type FulfillmentOrder,
} from "./model";
import { applyCommand, WorkflowError } from "./workflow";

const documentId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const roleSchema = z.enum(["coordinator", "packer", "runner"]);
const envelopeSchema = z
  .object({
    eventId: documentId,
    orderId: documentId,
    operationId: documentId,
    expectedVersion: z.number().int().nonnegative(),
    command: commandSchema,
  })
  .strict();
export type OperationResult = {
  orderId: string;
  version: number;
  replayed: boolean;
};

// Canonical JSON avoids treating object-key ordering as a different operation.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function fulfillmentKey(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new WorkflowError(code);
}

/** Internal server service. Callers must authenticate uid before invoking it.
 * Permissions are re-read inside every transaction, including operation replay.
 * The dry-packing API is feature-gated; no pilot integration is exposed.
 */
export class FulfillmentStore {
  constructor(
    private readonly db: Firestore,
    private readonly clock = () => new Date().toISOString(),
  ) {}

  private event(eventId: string) {
    return this.db
      .collection("fulfillmentEvents")
      .doc(documentId.parse(eventId));
  }

  private async authorize(
    tx: Transaction,
    eventId: string,
    uid: string,
  ): Promise<Actor> {
    documentId.parse(uid);
    const eventRef = this.event(eventId);
    const [event, grant] = await tx.getAll(
      eventRef,
      eventRef.collection("staff").doc(uid),
    );
    check(
      event.data()?.enabled === true && event.data()?.status === "OPEN",
      "eventDisabled",
    );
    const role = roleSchema.safeParse(grant.data()?.role);
    check(grant.data()?.active === true && role.success, "forbidden");
    return { id: uid, eventId, role: role.data };
  }

  async create(
    uid: string,
    operationId: string,
    input: unknown,
  ): Promise<OperationResult> {
    documentId.parse(operationId);
    const order = createFulfillmentOrder(input);
    const { id, eventId, source } = order.manifest;
    documentId.parse(id);
    const eventRef = this.event(eventId);
    const ref = this.db.collection("fulfillmentOrders").doc(id);
    const receiptRef = eventRef
      .collection("operations")
      .doc(fulfillmentKey([uid, operationId]));
    const sourceRef = eventRef
      .collection("sources")
      .doc(fulfillmentKey([source.kind, source.key]));
    const fingerprint = fulfillmentKey({
      type: "create",
      manifest: order.manifest,
    });
    const now = this.clock();
    return this.db.runTransaction(async (tx) => {
      const actor = await this.authorize(tx, eventId, uid);
      check(actor.role === "coordinator", "forbidden");
      const [receipt, existing, reserved] = await tx.getAll(
        receiptRef,
        ref,
        sourceRef,
      );
      if (receipt.exists) {
        check(receipt.data()!.fingerprint === fingerprint, "operationConflict");
        return {
          orderId: id,
          version: receipt.data()!.version as number,
          replayed: true,
        };
      }
      check(!existing.exists, "orderExists");
      check(!reserved.exists, "sourceAlreadyImported");
      tx.create(ref, order);
      tx.create(sourceRef, { orderId: id, source });
      tx.create(receiptRef, {
        fingerprint,
        orderId: id,
        version: 0,
        actor: uid,
        at: now,
      });
      tx.create(
        ref.collection("activity").doc(fulfillmentKey([uid, operationId])),
        {
          type: "create",
          actor: uid,
          at: now,
          version: 0,
        },
      );
      return { orderId: id, version: 0, replayed: false };
    });
  }

  async readDry(uid: string, input: unknown): Promise<DryResponse> {
    const request = z
      .object({
        eventId: documentId,
        cursor: documentId.optional(),
        orderId: documentId.optional(),
      })
      .strict()
      .parse(input);
    return this.db.runTransaction(async (tx) => {
      const actor = await this.authorize(tx, request.eventId, uid);
      check(
        actor.role === "coordinator" || actor.role === "packer",
        "forbidden",
      );
      let query = this.db
        .collection("fulfillmentOrders")
        .where("manifest.eventId", "==", request.eventId)
        .orderBy(FieldPath.documentId())
        .limit(51);
      if (request.cursor) query = query.startAfter(request.cursor);
      const records = await tx.get(query);
      const selected = request.orderId
        ? await tx.get(
            this.db.collection("fulfillmentOrders").doc(request.orderId),
          )
        : null;
      if (selected)
        check(
          selected.exists &&
            selected.data()!.manifest.eventId === request.eventId,
          "orderNotFound",
        );
      const locations = await tx.get(
        this.event(request.eventId).collection("locations").limit(201),
      );
      check(locations.size <= 200, "tooManyLocations");
      const available: DryLocation[] = locations.docs
        .filter((doc) => doc.data().active === true)
        .map((doc) => {
          const data = doc.data();
          return {
            code: data.code,
            capacity: data.capacity,
            count: data.count,
            orderId: data.orderId,
          };
        });
      return {
        actorId: actor.id,
        role: actor.role,
        orders: records.docs
          .slice(0, 50)
          .map((doc) => drySummary(doc.data() as FulfillmentOrder)),
        nextCursor: records.size > 50 ? records.docs[49].id : null,
        detail: selected
          ? dryDetail(selected.data() as FulfillmentOrder)
          : null,
        locations: available.sort((a, b) =>
          a.code.localeCompare(b.code, undefined, { numeric: true }),
        ),
      };
    });
  }

  async execute(
    uid: string,
    input: unknown,
    scope: "all" | "dry" = "all",
  ): Promise<OperationResult> {
    const request = envelopeSchema.parse(input);
    // Arrival requires a separately authenticated bridge; staff cannot forge it.
    check(request.command.type !== "arrival", "bridgeRequired");
    const eventRef = this.event(request.eventId);
    const ref = this.db.collection("fulfillmentOrders").doc(request.orderId);
    const receiptRef = eventRef
      .collection("operations")
      .doc(fulfillmentKey([uid, request.operationId]));
    const fingerprint = fulfillmentKey(request);
    const now = this.clock();
    return this.db.runTransaction(async (tx) => {
      const actor = await this.authorize(tx, request.eventId, uid);
      const [snapshot, receipt] = await tx.getAll(ref, receiptRef);
      check(snapshot.exists, "orderNotFound");
      const current = snapshot.data() as FulfillmentOrder;
      check(current.manifest.eventId === request.eventId, "forbidden");
      if (scope === "dry") {
        check(
          actor.role === "coordinator" || actor.role === "packer",
          "forbidden",
        );
        const command = request.command;
        check(
          ["claim", "resolve", "approve", "pack"].includes(command.type),
          "dryOnly",
        );
        if ("stage" in command)
          check(command.stage === "advanceDry", "dryOnly");
        if ("lineId" in command)
          check(
            current.manifest.lines.some(
              (line) =>
                line.id === command.lineId && line.stage === "advanceDry",
            ),
            "dryOnly",
          );
      }
      if (receipt.exists) {
        check(receipt.data()!.fingerprint === fingerprint, "operationConflict");
        return {
          orderId: request.orderId,
          version: receipt.data()!.version as number,
          replayed: true,
        };
      }
      const next = applyCommand(
        current,
        request.expectedVersion,
        actor,
        request.command,
        now,
      );
      // Reserve staging positions on packing; free them only on physical gather.
      // Cancellation/holds deliberately do not release occupied locations.
      const storedCounts = (order: FulfillmentOrder) => {
        const counts = new Map<string, number>();
        for (const pkg of order.packages)
          if (!pkg.custody && !pkg.handedOver) {
            counts.set(pkg.location, (counts.get(pkg.location) ?? 0) + 1);
          }
        return counts;
      };
      const before = storedCounts(current),
        after = storedCounts(next);
      const names = [...new Set([...before.keys(), ...after.keys()])].filter(
        (name) => before.get(name) !== after.get(name),
      );
      const locationRefs = names.map((name) =>
        eventRef.collection("locations").doc(fulfillmentKey(name)),
      );
      const locations = locationRefs.length
        ? await tx.getAll(...locationRefs)
        : [];
      const updates = locations.map((location, index) => {
        const data = location.data();
        const name = names[index];
        check(
          data && data.code === name && data.active === true,
          "locationUnavailable",
        );
        check(
          Number.isInteger(data.capacity) &&
            data.capacity > 0 &&
            Number.isInteger(data.count) &&
            data.count >= 0,
          "invalidLocation",
        );
        check(
          data.count === 0
            ? data.orderId === null
            : data.orderId === request.orderId,
          "locationOccupied",
        );
        check(data.count === (before.get(name) ?? 0), "locationCountConflict");
        const count = after.get(name) ?? 0;
        check(count <= data.capacity, "locationFull");
        return { count, orderId: count ? request.orderId : null };
      });
      tx.set(ref, next);
      locationRefs.forEach((location, index) =>
        tx.update(location, updates[index]),
      );
      tx.create(receiptRef, {
        fingerprint,
        orderId: request.orderId,
        version: next.version,
        actor: uid,
        at: now,
      });
      tx.create(
        ref
          .collection("activity")
          .doc(fulfillmentKey([uid, request.operationId])),
        {
          type: request.command.type,
          command: request.command,
          actor: uid,
          at: now,
          previousVersion: current.version,
          version: next.version,
        },
      );
      return {
        orderId: request.orderId,
        version: next.version,
        replayed: false,
      };
    });
  }
}
