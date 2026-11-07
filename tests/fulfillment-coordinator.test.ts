import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { adminAuth, adminDb } from "../src/lib/firebase-admin";
import { CoordinatorStore } from "../src/lib/fulfillment/coordinator-store";
import { FulfillmentStore, fulfillmentKey } from "../src/lib/fulfillment/store";
import { WorkflowError } from "../src/lib/fulfillment/workflow";
import { manifest } from "./fixtures/fulfillment";
import { GET, POST } from "../src/app/api/fulfillment/coordinator/route";
import type { Manifest } from "../src/lib/fulfillment/model";

let env: RulesTestEnvironment;
let now = "2026-11-07T16:00:00Z";
const store = new CoordinatorStore(adminDb, () => now);
const setup = {
  action: "createEvent",
  eventId: manifest.eventId,
  operationId: "create",
  label: "Example pickup",
  pickupDate: "2026-11-21",
  sourceScope: "example-sheet/tab",
  mappingVersion: manifest.mappingVersion,
};
const event = () => adminDb.doc(`fulfillmentEvents/${manifest.eventId}`);
const input = () => ({
  ...manifest,
  source: { ...manifest.source, key: "example-sheet/tab/registration" },
});
async function rejects(code: string, promise: Promise<unknown>) {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof WorkflowError && error.code === code,
  );
}
async function preview(
  operationId = "preview",
  manifests: Manifest[] = [input()],
) {
  const result = await store.execute("admin", {
    action: "preview",
    eventId: manifest.eventId,
    operationId,
    manifests,
  });
  assert.ok("draft" in result);
  return result.draft;
}
const apply = (draftId = "preview") =>
  store.execute("admin", {
    action: "apply",
    eventId: manifest.eventId,
    draftId,
    confirmed: true,
  });
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
  now = "2026-11-07T16:00:00Z";
  await env.clearFirestore();
  await adminDb.doc("users/admin").set({ role: "ADMIN" });
});

test("only existing administrators bootstrap disabled events without changing a pilot batch", async () => {
  await adminDb.doc("batches/pilot").set({ status: "OPEN" });
  await rejects("forbidden", store.execute("packer", setup));
  await store.execute("admin", setup);
  assert.equal((await event().get()).data()!.enabled, false);
  assert.equal((await event().get()).data()!.status, "CLOSED");
  assert.equal(
    (await adminDb.doc("batches/pilot").get()).data()!.status,
    "OPEN",
  );
  const retry = await store.execute("admin", setup);
  assert.ok("replayed" in retry && retry.replayed);
  await rejects(
    "eventExists",
    store.execute("admin", { ...setup, operationId: "different" }),
  );
  await rejects(
    "operationConflict",
    store.execute("admin", { ...setup, label: "Changed" }),
  );
  await assert.rejects(
    store.execute("admin", { ...setup, pickupDate: "2026-02-30" }),
  );
});

test("coordinator setup protects grants, occupied locations and stale versions", async () => {
  await store.execute("admin", setup);
  await rejects(
    "locationRequired",
    store.execute("admin", {
      action: "setEnabled",
      eventId: manifest.eventId,
      operationId: "enable",
      expectedVersion: 0,
      enabled: true,
    }),
  );
  const location = {
    action: "location",
    eventId: manifest.eventId,
    operationId: "position",
    expectedVersion: 0,
    code: "B04",
    capacity: 3,
    active: true,
  };
  await store.execute("admin", location);
  await store.execute("admin", location); // Does not increment setup twice.
  await rejects(
    "staleVersion",
    store.execute("admin", { ...location, operationId: "stale" }),
  );
  await store.execute("admin", {
    action: "staff",
    eventId: manifest.eventId,
    operationId: "grant",
    expectedVersion: 1,
    uid: "packer",
    role: "packer",
    active: true,
  });
  await rejects(
    "forbidden",
    store.read("packer", { eventId: manifest.eventId }),
  );
  await rejects(
    "coordinatorProtected",
    store.execute("admin", {
      action: "staff",
      eventId: manifest.eventId,
      operationId: "downgrade",
      expectedVersion: 2,
      uid: "admin",
      role: "packer",
      active: false,
    }),
  );
  await event()
    .collection("locations")
    .doc(fulfillmentKey("B04"))
    .update({ count: 2, orderId: "packed-order" });
  await rejects(
    "locationOccupied",
    store.execute("admin", {
      ...location,
      operationId: "shrink",
      expectedVersion: 2,
      capacity: 1,
    }),
  );
  await rejects(
    "locationOccupied",
    store.execute("admin", {
      ...location,
      operationId: "disable",
      expectedVersion: 2,
      active: false,
    }),
  );
  assert.equal(
    (await store.read("admin", { eventId: manifest.eventId })).locations[0]
      .count,
    2,
  );
});

test("preview is non-mutating and apply is atomic and safe to retry", async () => {
  await store.execute("admin", setup);
  const draft = await preview();
  assert.equal(draft.rows[0].status, "new");
  assert.equal((await adminDb.collection("fulfillmentOrders").get()).size, 0);
  const results = await Promise.all([apply(), apply(), apply()]);
  assert.equal(
    results.filter((result) => "replayed" in result && !result.replayed).length,
    1,
  );
  assert.equal((await adminDb.collection("fulfillmentOrders").get()).size, 1);
  assert.equal((await event().collection("sources").get()).size, 1);
  assert.equal((await preview("again")).rows[0].status, "unchanged");
  await apply("again");
  assert.equal((await adminDb.collection("fulfillmentOrders").get()).size, 1);
  assert.equal((await adminDb.collection("users").get()).size, 1);
});

test("duplicate identities, wrong sources, wrong mappings and events block whole imports", async () => {
  await store.execute("admin", setup);
  const duplicate = await preview("duplicate", [
    input(),
    { ...input(), householdLabel: "Second household" },
  ]);
  assert.ok(duplicate.rows.every((row) => row.status === "blocked"));
  await rejects("previewBlocked", apply("duplicate"));
  for (const [id, change] of Object.entries({
    scope: { source: { ...input().source, key: "other/tab/id" } },
    mapping: { mappingVersion: "unreviewed" },
    event: { eventId: "other" },
  })) {
    assert.equal(
      (await preview(id, [{ ...input(), ...change }])).rows[0].status,
      "blocked",
    );
    await rejects("previewBlocked", apply(id));
  }
  assert.equal((await adminDb.collection("fulfillmentOrders").get()).size, 0);
});

test("changed submissions preserve existing claimed work", async () => {
  await store.execute("admin", setup);
  const draft = await preview();
  await apply();
  const orderId = draft.rows[0].manifest.id;
  await event().update({ enabled: true, status: "OPEN" });
  const fulfillment = new FulfillmentStore(adminDb);
  await fulfillment.execute("admin", {
    eventId: manifest.eventId,
    orderId,
    operationId: "claim",
    expectedVersion: 0,
    command: { type: "claim", stage: "advanceDry" },
  });
  const before = (
    await adminDb.doc(`fulfillmentOrders/${orderId}`).get()
  ).data();
  const changed = await preview("changed", [
    { ...input(), notes: "Changed after picking started" },
  ]);
  assert.equal(changed.rows[0].status, "blocked");
  await rejects("previewBlocked", apply("changed"));
  assert.deepEqual(
    (await adminDb.doc(`fulfillmentOrders/${orderId}`).get()).data(),
    before,
  );
});

test("stale, expired, or revoked previews cannot write; valid subsets are never partially applied", async () => {
  await store.execute("admin", setup);
  await preview();
  await event().update({ version: 1 });
  await rejects("stalePreview", apply());
  await preview("expires");
  now = "2026-11-07T17:00:00Z";
  await rejects("draftExpired", apply("expires"));
  const second = {
    ...input(),
    source: { ...input().source, key: "example-sheet/tab/second" },
  };
  const draft = await preview("race", [input(), second]);
  await adminDb
    .doc(`fulfillmentOrders/${draft.rows[1].manifest.id}`)
    .set({ external: true });
  await rejects("stalePreview", apply("race"));
  assert.equal(
    (await adminDb.doc(`fulfillmentOrders/${draft.rows[0].manifest.id}`).get())
      .exists,
    false,
  );
  await event().collection("staff").doc("admin").update({ active: false });
  await rejects("forbidden", apply("race"));
});

test("setup and preview data cannot be read or changed by another event's coordinator", async () => {
  await store.execute("admin", setup);
  await adminDb
    .doc("fulfillmentEvents/other/staff/intruder")
    .set({ role: "coordinator", active: true });
  await rejects(
    "forbidden",
    store.read("intruder", { eventId: manifest.eventId }),
  );
  await rejects(
    "forbidden",
    store.execute("intruder", {
      action: "preview",
      eventId: manifest.eventId,
      operationId: "attack",
      manifests: [input()],
    }),
  );
  await rejects(
    "forbidden",
    store.execute("intruder", {
      action: "apply",
      eventId: manifest.eventId,
      draftId: "attack",
      confirmed: true,
    }),
  );
});

test("coordinator API is opt-in and rejects anonymous and nonexistent staff grants", async () => {
  const previous = process.env.FULFILLMENT_PHASE_TWO_ENABLED;
  const url = `http://localhost/api/fulfillment/coordinator?eventId=${manifest.eventId}`;
  try {
    delete process.env.FULFILLMENT_PHASE_TWO_ENABLED;
    assert.equal((await GET(new Request(url))).status, 404);
    process.env.FULFILLMENT_PHASE_TWO_ENABLED = "true";
    assert.equal(
      (await POST(new Request(url, { method: "POST" }))).status,
      401,
    );
    const token = await adminAuth.createCustomToken("admin");
    const response = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, returnSecureToken: true }),
      },
    );
    const { idToken } = (await response.json()) as { idToken: string };
    const headers = {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    };
    const post = (body: unknown) =>
      POST(
        new Request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
    assert.equal((await post(setup)).status, 200);
    assert.equal((await GET(new Request(url, { headers }))).status, 200);
    assert.equal(
      (
        await post({
          action: "staff",
          eventId: manifest.eventId,
          operationId: "grant",
          expectedVersion: 0,
          uid: "does-not-exist",
          role: "packer",
          active: true,
        })
      ).status,
      400,
    );
    assert.equal((await event().get()).data()!.version, 0);
  } finally {
    if (previous === undefined)
      delete process.env.FULFILLMENT_PHASE_TWO_ENABLED;
    else process.env.FULFILLMENT_PHASE_TWO_ENABLED = previous;
  }
});
