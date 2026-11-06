import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { adminDb } from "../src/lib/firebase-admin";
import { FulfillmentStore, fulfillmentKey } from "../src/lib/fulfillment/store";
import { WorkflowError } from "../src/lib/fulfillment/workflow";
import { manifest, arrival } from "./fixtures/fulfillment";
import type { Command } from "../src/lib/fulfillment/model";

let env: RulesTestEnvironment;
const store = new FulfillmentStore(adminDb, () => "2026-11-07T16:00:00Z");
const event = () => adminDb.doc(`fulfillmentEvents/${manifest.eventId}`);
const orderRef = () => adminDb.doc(`fulfillmentOrders/${manifest.id}`);
async function rejects(code: string, action: Promise<unknown>) {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof WorkflowError && error.code === code,
  );
}
function execute(
  uid: string,
  operationId: string,
  expectedVersion: number,
  command: Command,
  orderId = manifest.id,
) {
  return store.execute(uid, {
    eventId: manifest.eventId,
    orderId,
    operationId,
    expectedVersion,
    command,
  });
}
async function prepare(id = manifest.id) {
  await store.create("coordinator", `create-${id}`, {
    ...manifest,
    id,
    source: { ...manifest.source, key: id },
    lines: [manifest.lines[0]],
  });
  await execute(
    "packer",
    `claim-${id}`,
    0,
    { type: "claim", stage: "advanceDry" },
    id,
  );
  await execute(
    "packer",
    `resolve-${id}`,
    1,
    {
      type: "resolve",
      lineId: "rice",
      quantity: 2,
      replacement: null,
      reason: null,
    },
    id,
  );
}
before(async () => {
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "demo-food-source");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  env = await initializeTestEnvironment({
    projectId: "demo-food-source",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});
after(async () => {
  await env?.cleanup();
  await adminDb.terminate();
});
beforeEach(async () => {
  await env.clearFirestore();
  await event().set({ enabled: true, status: "OPEN" });
  for (const [uid, role] of Object.entries({
    coordinator: "coordinator",
    packer: "packer",
    other: "packer",
    runner: "runner",
  })) {
    await event().collection("staff").doc(uid).set({ role, active: true });
  }
  await event()
    .collection("locations")
    .doc(fulfillmentKey("B04"))
    .set({ code: "B04", capacity: 2, count: 0, orderId: null, active: true });
});

test("create is atomic and idempotent without creating a client profile", async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      store.create("coordinator", "create", manifest),
    ),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal((await adminDb.collection("fulfillmentOrders").get()).size, 1);
  assert.equal((await adminDb.collection("users").get()).size, 0);
  assert.equal((await event().collection("sources").get()).size, 1);
  await rejects(
    "operationConflict",
    store.create("coordinator", "create", {
      ...manifest,
      householdLabel: "Changed",
    }),
  );
  await rejects(
    "sourceAlreadyImported",
    store.create("coordinator", "other-create", {
      ...manifest,
      id: "another-order",
    }),
  );
});

test("transactional claims select one winner and repeated requests reuse one audit receipt", async () => {
  await store.create("coordinator", "create", manifest);
  const results = await Promise.allSettled(
    ["packer", "other"].map((uid) =>
      execute(uid, "claim", 0, { type: "claim", stage: "advanceDry" }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const winner = (await orderRef().get()).data()!.portions.advanceDry.owner;
  const replay = await execute(winner, "claim", 0, {
    type: "claim",
    stage: "advanceDry",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.version, 1);
  assert.equal((await orderRef().collection("activity").get()).size, 2);
  await rejects(
    "operationConflict",
    execute(winner, "claim", 1, { type: "claim", stage: "afterArrival" }),
  );
});

test("disabled events, missing/revoked grants and forged arrivals fail closed", async () => {
  await rejects("forbidden", store.create("unknown", "create", manifest));
  await rejects("forbidden", store.create("packer", "create", manifest));
  await store.create("coordinator", "create", manifest);
  await event()
    .collection("staff")
    .doc("coordinator")
    .update({ active: false });
  await rejects("forbidden", store.create("coordinator", "create", manifest));
  await rejects(
    "arrivalRequired",
    execute("packer", "early", 0, { type: "claim", stage: "afterArrival" }),
  );
  await rejects(
    "bridgeRequired",
    execute("packer", "fake-arrival", 0, { type: "arrival", arrival }),
  );
  for (const change of [
    { enabled: false, status: "OPEN" },
    { enabled: true, status: "CLOSED" },
  ]) {
    await event().set(change);
    await rejects(
      "eventDisabled",
      execute("packer", "claim", 0, { type: "claim", stage: "advanceDry" }),
    );
  }
  assert.equal((await orderRef().get()).data()!.version, 0);
});

test("two orders cannot occupy the same staging position", async () => {
  await prepare("order-a");
  await prepare("order-b");
  const result = await Promise.allSettled(
    ["order-a", "order-b"].map((id) =>
      execute(
        "packer",
        `pack-${id}`,
        2,
        {
          type: "pack",
          stage: "advanceDry",
          packages: [{ id: "D1", location: "B04" }],
        },
        id,
      ),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const failed = result.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(failed.reason.code, "locationOccupied");
  const location = (
    await event().collection("locations").doc(fulfillmentKey("B04")).get()
  ).data()!;
  assert.equal(location.count, 1);
  assert.ok(["order-a", "order-b"].includes(location.orderId));
});

test("failed staging rolls back order, receipt and activity writes", async () => {
  await prepare();
  await rejects(
    "locationUnavailable",
    execute("packer", "pack", 2, {
      type: "pack",
      stage: "advanceDry",
      packages: [{ id: "D1", location: "Unknown" }],
    }),
  );
  await rejects(
    "locationFull",
    execute("packer", "overfull", 2, {
      type: "pack",
      stage: "advanceDry",
      packages: [1, 2, 3].map((n) => ({ id: `D${n}`, location: "B04" })),
    }),
  );
  assert.equal((await orderRef().get()).data()!.version, 2);
  assert.equal((await orderRef().collection("activity").get()).size, 3);
  assert.equal((await event().collection("operations").get()).size, 3);
});

test("cancellation retains occupied goods; stale commands cannot override it", async () => {
  await prepare();
  await execute("packer", "pack", 2, {
    type: "pack",
    stage: "advanceDry",
    packages: [{ id: "D1", location: "B04" }],
  });
  await execute("coordinator", "cancel", 3, {
    type: "control",
    state: "cancelled",
    reason: "Client cancelled",
  });
  await rejects(
    "staleVersion",
    execute("runner", "stale", 3, { type: "gather", packageId: "D1" }),
  );
  await rejects(
    "orderInactive",
    execute("runner", "gather", 4, { type: "gather", packageId: "D1" }),
  );
  assert.equal(
    (
      await event().collection("locations").doc(fulfillmentKey("B04")).get()
    ).data()!.count,
    1,
  );
});

test("gather releases the occupied position only after a confirmed arrival", async () => {
  await prepare();
  await execute("packer", "pack", 2, {
    type: "pack",
    stage: "advanceDry",
    packages: [{ id: "D1", location: "B04" }],
  });
  await rejects(
    "arrivalRequired",
    execute("runner", "early", 3, { type: "gather", packageId: "D1" }),
  );
  // Test-only setup: no production arrival bridge is exposed by this slice.
  await orderRef().update({ arrival });
  await execute("runner", "gather", 3, { type: "gather", packageId: "D1" });
  const location = (
    await event().collection("locations").doc(fulfillmentKey("B04")).get()
  ).data()!;
  assert.equal(location.count, 0);
  assert.equal(location.orderId, null);
  await execute("runner", "handoff", 4, { type: "handoff" });
  assert.ok((await orderRef().get()).data()!.deliveredAt);
});

test("cross-event commands and direct Firestore clients cannot access fulfillment", async () => {
  await store.create("coordinator", "create", manifest);
  await adminDb
    .doc("fulfillmentEvents/another")
    .set({ enabled: true, status: "OPEN" });
  await adminDb
    .doc("fulfillmentEvents/another/staff/packer")
    .set({ role: "packer", active: true });
  await rejects(
    "forbidden",
    store.execute("packer", {
      eventId: "another",
      orderId: manifest.id,
      operationId: "claim",
      expectedVersion: 0,
      command: { type: "claim", stage: "advanceDry" },
    }),
  );
  for (const client of [
    env.unauthenticatedContext().firestore(),
    env.authenticatedContext("coordinator").firestore(),
  ]) {
    await assertFails(getDoc(doc(client, "fulfillmentOrders", manifest.id)));
    await assertFails(
      setDoc(doc(client, "fulfillmentOrders", manifest.id), { version: 99 }),
    );
    await assertFails(
      setDoc(
        doc(client, "fulfillmentEvents", manifest.eventId, "staff", "intruder"),
        { active: true, role: "coordinator" },
      ),
    );
  }
});
