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
import { manifest, arrival } from "./fixtures/fulfillment";
import {
  selectionTiming,
  type ReconciliationAddition,
} from "../src/lib/fulfillment/reconciliation";
import { GET, POST } from "../src/app/api/fulfillment/coordinator/route";
import type {
  FulfillmentOrder,
  Line,
  Manifest,
} from "../src/lib/fulfillment/model";

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

test("reviewed unstarted changes retain identity, audit both manifests and retry once", async () => {
  await store.execute("admin", setup);
  const first = await preview();
  await apply();
  const id = first.rows[0].manifest.id;
  const replacement = {
    ...input(),
    notes: "No substitutions",
    source: { ...input().source, revision: "v2" },
  };
  const draft = await preview("revision", [replacement]);
  assert.equal(draft.rows[0].status, "update");
  assert.deepEqual(draft.rows[0].previousManifest, first.rows[0].manifest);
  const results = await Promise.all([apply("revision"), apply("revision")]);
  assert.equal(results.filter((r) => "replayed" in r && !r.replayed).length, 1);
  const ref = adminDb.doc(`fulfillmentOrders/${id}`);
  const order = (await ref.get()).data()!;
  assert.equal(order.version, 1);
  assert.equal(order.manifest.notes, replacement.notes);
  assert.equal(order.portions.afterArrival.state, "waiting");
  assert.deepEqual(order.packages, []);
  const audit = (
    await ref.collection("activity").doc("import-revision").get()
  ).data()!;
  assert.deepEqual(audit.previousManifest, first.rows[0].manifest);
  assert.equal(audit.manifest.notes, replacement.notes);
  assert.equal(
    (await preview("same", [replacement])).rows[0].status,
    "unchanged",
  );
});

test("claim after preview rejects the whole update batch without overwriting work", async () => {
  await store.execute("admin", setup);
  const first = await preview();
  await apply();
  const orderId = first.rows[0].manifest.id;
  const fresh = {
    ...input(),
    source: { ...input().source, key: "example-sheet/tab/new" },
  };
  const draft = await preview("race-update", [
    { ...input(), notes: "Changed" },
    fresh,
  ]);
  assert.equal(draft.rows[0].status, "update");
  await event().update({ enabled: true, status: "OPEN" });
  await new FulfillmentStore(adminDb).execute("admin", {
    eventId: manifest.eventId,
    orderId,
    operationId: "claim-race",
    expectedVersion: 0,
    command: { type: "claim", stage: "advanceDry" },
  });
  await rejects("stalePreview", apply("race-update"));
  const order = (
    await adminDb.doc(`fulfillmentOrders/${orderId}`).get()
  ).data()!;
  assert.equal(order.portions.advanceDry.state, "picking");
  assert.equal(order.manifest.notes, input().notes);
  assert.equal(
    (await adminDb.doc(`fulfillmentOrders/${draft.rows[1].manifest.id}`).get())
      .exists,
    false,
  );
});

test("held, arrived, resolved and packed orders cannot be replaced by source imports", async () => {
  await store.execute("admin", setup);
  const first = await preview();
  await apply();
  const ref = adminDb.doc(`fulfillmentOrders/${first.rows[0].manifest.id}`);
  const original = (await ref.get()).data()!;
  const cases = [
    { control: "held", reason: "Review" },
    { arrival: { id: "arrived" } },
    { resolutions: { rice: { quantity: 1 } } },
    { packages: [{ id: "box" }] },
    { deliveredAt: now },
  ];
  for (const [i, change] of cases.entries()) {
    await ref.set({ ...original, ...change });
    assert.equal(
      (await preview(`protected-${i}`, [{ ...input(), notes: "Changed" }]))
        .rows[0].status,
      "blocked",
    );
    await rejects("previewBlocked", apply(`protected-${i}`));
    assert.deepEqual((await ref.get()).data(), { ...original, ...change });
  }
});

test("a conflicting source reservation cannot replace another order", async () => {
  await store.execute("admin", setup);
  const draft = await preview();
  await apply();
  const ref = adminDb.doc(`fulfillmentOrders/${draft.rows[0].manifest.id}`);
  await ref.update({ "manifest.eventId": "other-event" });
  assert.equal(
    (await preview("bad-pointer", [{ ...input(), notes: "Changed" }])).rows[0]
      .status,
    "blocked",
  );
  await rejects("previewBlocked", apply("bad-pointer"));
  assert.equal((await ref.get()).data()!.manifest.eventId, "other-event");
});

const allocation = {
  itemId: "rice",
  item: "Rice",
  unit: "bag",
  available: 12,
  eligibilityConfirmed: true,
  households: [
    { key: "a", label: "Example A", size: 2 },
    { key: "b", label: "Example B", size: 4 },
  ],
};
async function allocationPreview(
  operationId = "allocation",
  input = allocation,
) {
  const result = await store.execute("admin", {
    action: "allocationPreview",
    eventId: manifest.eventId,
    operationId,
    input,
  });
  assert.ok("allocationDraft" in result);
  return result.allocationDraft;
}
const approveAllocation = (
  draftId = "allocation",
  quantities = [
    { key: "a", quantity: 4, reason: "" },
    { key: "b", quantity: 8, reason: "" },
  ],
) =>
  store.execute("admin", {
    action: "allocationApprove",
    eventId: manifest.eventId,
    draftId,
    quantities,
    confirmed: true,
  });

test("allocation approval is audited, retry-safe, readable and cannot create packing work", async () => {
  await store.execute("admin", setup);
  const draft = await allocationPreview();
  assert.deepEqual(
    draft.proposed.map((q) => q.quantity),
    [4, 8],
  );
  assert.equal((await event().collection("allocationItems").get()).size, 0);
  const results = await Promise.all([approveAllocation(), approveAllocation()]);
  assert.equal(results.filter((r) => "replayed" in r && !r.replayed).length, 1);
  assert.equal((await adminDb.collection("fulfillmentOrders").get()).size, 0);
  assert.equal((await event().get()).data()!.enabled, false);
  const view = await store.read("admin", { eventId: manifest.eventId });
  assert.equal(view.allocations[0].allocated, 12);
  assert.equal(view.allocations[0].version, 1);
  const read = await store.execute("admin", {
    action: "allocationRead",
    eventId: manifest.eventId,
    draftId: draft.id,
  });
  assert.ok("allocationDraft" in read && read.allocationDraft.approvedAt);
  assert.equal(
    (
      await event().collection("activity").doc("allocation-allocation").get()
    ).data()!.actor,
    "admin",
  );
  await rejects(
    "operationConflict",
    approveAllocation("allocation", [
      { key: "a", quantity: 3, reason: "Changed" },
      { key: "b", quantity: 8, reason: "" },
    ]),
  );
});

test("allocation approval rejects overstock, missing reasons, changed households and stale item plans", async () => {
  await store.execute("admin", setup);
  await allocationPreview();
  await allocationPreview("competing");
  await rejects(
    "allocationOverStock",
    approveAllocation("allocation", [
      { key: "a", quantity: 5, reason: "Extra" },
      { key: "b", quantity: 8, reason: "" },
    ]),
  );
  await rejects(
    "allocationReasonRequired",
    approveAllocation("allocation", [
      { key: "a", quantity: 3, reason: "" },
      { key: "b", quantity: 8, reason: "" },
    ]),
  );
  await rejects(
    "allocationHouseholdsChanged",
    approveAllocation("allocation", [{ key: "a", quantity: 4, reason: "" }]),
  );
  await approveAllocation("allocation", [
    { key: "a", quantity: 3, reason: "Reserve one" },
    { key: "b", quantity: 8, reason: "" },
  ]);
  await rejects("staleAllocation", approveAllocation("competing"));
  await allocationPreview("replacement", { ...allocation, available: 6 });
  await approveAllocation("replacement", [
    { key: "a", quantity: 2, reason: "" },
    { key: "b", quantity: 4, reason: "" },
  ]);
  assert.equal(
    (await event().collection("allocationItems").doc("rice").get()).data()!
      .version,
    2,
  );
  assert.equal(
    (
      await event().collection("allocationDrafts").doc("allocation").get()
    ).data()!.approved[0].quantity,
    3,
  );
});

test("allocation drafts honor event permissions, configuration versions, expiry and revocation", async () => {
  await store.execute("admin", setup);
  await allocationPreview();
  await rejects(
    "forbidden",
    store.execute("packer", {
      action: "allocationRead",
      eventId: manifest.eventId,
      draftId: "allocation",
    }),
  );
  await rejects(
    "forbidden",
    store.execute("packer", {
      action: "allocationPreview",
      eventId: manifest.eventId,
      operationId: "attack",
      input: allocation,
    }),
  );
  await event().update({ version: 1 });
  await rejects("stalePreview", approveAllocation());
  await allocationPreview("expiry");
  now = "2026-11-07T17:00:00Z";
  await rejects("draftExpired", approveAllocation("expiry"));
  await allocationPreview("revoked");
  await event().collection("staff").doc("admin").update({ active: false });
  await rejects("forbidden", approveAllocation("revoked"));
  assert.equal((await event().collection("allocationItems").get()).size, 0);
});

async function setupPacking(available = 12) {
  await store.execute("admin", setup);
  await allocationPreview("packing-plan", { ...allocation, available });
  // Use bag units to match the reviewed allocation exactly.
  const records = allocation.households.map((h, i) => ({
    ...input(),
    householdLabel: h.label,
    source: { ...input().source, key: `example-sheet/tab/packing-${i}` },
    lines: input().lines.map((l) =>
      l.id === "rice" ? { ...l, item: "Rice", unit: "bag" } : l,
    ),
  }));
  const imported = await preview("packing-orders", records);
  await apply("packing-orders");
  const approved = (
    await allocationPreview("packing-plan", { ...allocation, available })
  ).proposed;
  await approveAllocation("packing-plan", approved);
  const links = imported.rows.map((r, i) => ({
    householdKey: allocation.households[i].key,
    orderId: r.manifest.id,
    lineId: "rice",
  }));
  return { links, records };
}
async function packingPreview(
  links: { householdKey: string; orderId: string; lineId: string }[],
  operationId = "packing-preview",
) {
  const result = await store.execute("admin", {
    action: "packingAllocationPreview",
    eventId: manifest.eventId,
    planId: "packing-plan",
    operationId,
    links,
  });
  assert.ok("packingDraft" in result && result.packingDraft);
  return result.packingDraft;
}
const packingApply = (draftId = "packing-preview") =>
  store.execute("admin", {
    action: "packingAllocationApply",
    eventId: manifest.eventId,
    draftId,
    confirmed: true,
  });

test("approved allocation connects atomically to packing targets, retaining source requests and timing", async () => {
  const { links, records } = await setupPacking();
  const draft = await packingPreview(links);
  assert.deepEqual(
    draft.rows.map((r) => r.quantity),
    [4, 8],
  );
  const results = await Promise.all([packingApply(), packingApply()]);
  assert.equal(results.filter((r) => "replayed" in r && !r.replayed).length, 1);
  const first = (
    await adminDb.doc(`fulfillmentOrders/${links[0].orderId}`).get()
  ).data()!;
  assert.equal(first.version, 1);
  assert.equal(first.allocations.rice.quantity, 4);
  assert.deepEqual(first.manifest.lines, records[0].lines);
  assert.equal(first.portions.afterArrival.state, "waiting");
  await event().update({ enabled: true, status: "OPEN" });
  const fulfillment = new FulfillmentStore(adminDb);
  const view = await fulfillment.readDry("admin", {
    eventId: manifest.eventId,
    orderId: links[0].orderId,
  });
  assert.equal(view.detail!.lines.find((l) => l.id === "rice")!.quantity, 4);
  const execute = (
    operationId: string,
    expectedVersion: number,
    command: unknown,
  ) =>
    fulfillment.execute(
      "admin",
      {
        eventId: manifest.eventId,
        orderId: links[0].orderId,
        operationId,
        expectedVersion,
        command,
      },
      "dry",
    );
  await execute("claim-allocated", 1, { type: "claim", stage: "advanceDry" });
  await rejects(
    "excessQuantity",
    execute("too-much", 2, {
      type: "resolve",
      lineId: "rice",
      quantity: 5,
      replacement: null,
      reason: null,
    }),
  );
  await execute("pick-allocated", 2, {
    type: "resolve",
    lineId: "rice",
    quantity: 4,
    replacement: null,
    reason: null,
  });
  await rejects("allocationAlreadyReleased", packingPreview(links, "again"));
  await allocationPreview("revision-after-release");
  await rejects(
    "allocationAlreadyReleased",
    approveAllocation("revision-after-release"),
  );
});

test("zero shares stay visible and source updates cannot erase applied allocations", async () => {
  const { links, records } = await setupPacking(1);
  await packingPreview(links);
  await packingApply();
  await event().update({ enabled: true, status: "OPEN" });
  const fulfillment = new FulfillmentStore(adminDb);
  const view = await fulfillment.readDry("admin", {
    eventId: manifest.eventId,
    orderId: links[0].orderId,
  });
  assert.equal(view.detail!.lines.find((l) => l.id === "rice")!.quantity, 0);
  const change = await preview("changed-allocated", [
    { ...records[0], notes: "Source changed" },
  ]);
  assert.equal(change.rows[0].status, "blocked");
  await rejects("previewBlocked", apply("changed-allocated"));
  const same = await preview("same-allocated", [records[0]]);
  assert.equal(same.rows[0].status, "unchanged");
  await apply("same-allocated");
  assert.equal(
    (await adminDb.doc(`fulfillmentOrders/${links[0].orderId}`).get()).data()!
      .allocations.rice.quantity,
    0,
  );
});

test("packing link validation rejects incomplete, duplicated, cross-event and mismatched links", async () => {
  const { links } = await setupPacking();
  await rejects(
    "allocationHouseholdsChanged",
    packingPreview(links.slice(0, 1)),
  );
  await rejects(
    "allocationHouseholdsChanged",
    packingPreview([links[0], links[0]]),
  );
  await rejects(
    "packingItemMismatch",
    packingPreview([{ ...links[0], lineId: "diapers" }, links[1]]),
  );
  await rejects(
    "packingHouseholdMismatch",
    packingPreview([
      { ...links[0], orderId: links[1].orderId },
      { ...links[1], orderId: links[0].orderId },
    ]),
  );
  await adminDb
    .doc(`fulfillmentOrders/${links[0].orderId}`)
    .update({ "manifest.eventId": "other" });
  await rejects("packingOrderNotFound", packingPreview(links));
});

test("work or source changes after packing preview roll back every household", async () => {
  const { links } = await setupPacking();
  await packingPreview(links);
  await event().update({ enabled: true, status: "OPEN" });
  await new FulfillmentStore(adminDb).execute("admin", {
    eventId: manifest.eventId,
    orderId: links[1].orderId,
    operationId: "claim-before-release",
    expectedVersion: 0,
    command: { type: "claim", stage: "advanceDry" },
  });
  await rejects("stalePreview", packingApply());
  assert.equal(
    (await adminDb.doc(`fulfillmentOrders/${links[0].orderId}`).get()).data()!
      .allocations,
    undefined,
  );
  assert.equal(
    (await event().collection("allocationItems").doc("rice").get()).data()!
      .packingPlanId,
    undefined,
  );
  await rejects("packingWorkStarted", packingPreview(links, "after-claim"));
});

test("packing release rejects replaced plans, expired previews, revoked access and reuse with different links", async () => {
  const { links } = await setupPacking();
  await packingPreview(links);
  await rejects("operationConflict", packingPreview([...links].reverse()));
  await allocationPreview("new-plan");
  await approveAllocation("new-plan");
  await rejects("staleAllocation", packingApply());
  await rejects("staleAllocation", packingPreview(links, "stale-plan"));
  await event()
    .collection("allocationItems")
    .doc("rice")
    .update({ draftId: "packing-plan", version: 1 }); // Restore fixture pointer only.
  await packingPreview(links, "expires-packing");
  now = "2026-11-07T17:00:00Z";
  await rejects("draftExpired", packingApply("expires-packing"));
  await event().collection("staff").doc("admin").update({ active: false });
  await rejects("forbidden", packingApply());
});

test("household bindings persist across item plans and conflicting links cannot redirect allocations", async () => {
  const { links, records } = await setupPacking();
  await packingPreview(links);
  await packingApply();
  const secondInput = {
    ...allocation,
    itemId: "diapers",
    item: "Diapers size 3",
    unit: "pack",
  };
  await allocationPreview("diaper-plan", secondInput);
  await approveAllocation("diaper-plan");
  const duplicate = await preview("duplicate-household-order", [
    {
      ...records[0],
      source: {
        ...records[0].source,
        key: "example-sheet/tab/other-registration",
      },
    },
  ]);
  await apply("duplicate-household-order");
  const request = {
    action: "packingAllocationPreview",
    eventId: manifest.eventId,
    planId: "diaper-plan",
    operationId: "diaper-link",
    links: links.map((link) => ({ ...link, lineId: "diapers" })),
  };
  await rejects(
    "packingHouseholdMismatch",
    store.execute("admin", {
      ...request,
      links: [
        { ...request.links[0], orderId: duplicate.rows[0].manifest.id },
        request.links[1],
      ],
    }),
  );
  const result = await store.execute("admin", request);
  assert.ok("packingDraft" in result && result.packingDraft);
  await packingApply(result.packingDraft.id);
  const order = (
    await adminDb.doc(`fulfillmentOrders/${links[0].orderId}`).get()
  ).data()!;
  assert.equal(order.allocations.rice.quantity, 4);
  assert.equal(order.allocations.diapers.quantity, 4);
  assert.equal(order.version, 2);
});

test("duplicate matching item lines block packing release instead of exceeding the approved share", async () => {
  const { links } = await setupPacking();
  const ref = adminDb.doc(`fulfillmentOrders/${links[0].orderId}`);
  const order = (await ref.get()).data()!;
  await ref.update({
    "manifest.lines": [
      ...order.manifest.lines,
      { ...order.manifest.lines[0], id: "rice-copy" },
    ],
  });
  await rejects("packingItemMismatch", packingPreview(links));
});

async function reconciliationFixture() {
  const { links } = await setupPacking();
  await packingPreview(links);
  await packingApply();
  await event().update({ enabled: true, status: "OPEN" });
  const ref = adminDb.doc(`fulfillmentOrders/${links[0].orderId}`);
  const fulfillment = new FulfillmentStore(adminDb);
  await fulfillment.execute("admin", {
    eventId: manifest.eventId,
    orderId: ref.id,
    operationId: "claim-reconcile",
    expectedVersion: 1,
    command: { type: "claim", stage: "advanceDry" },
  });
  const start = await store.execute("admin", {
    action: "reconciliationStart",
    eventId: manifest.eventId,
    orderId: ref.id,
    operationId: "review",
    expectedVersion: 2,
    reason: "Stock and instructions changed",
  });
  assert.ok("reconciliation" in start && start.reconciliation);
  return { ref, fulfillment, order: start.reconciliation.order };
}
async function reconcilePreview(
  order: FulfillmentOrder,
  quantity = 3,
  operationId = "revised",
) {
  return store.execute("admin", {
    action: "reconciliationPreview",
    eventId: manifest.eventId,
    reviewId: "review",
    operationId,
    manifest: { ...order.manifest, notes: "Revised packing instructions" },
    adjustments: [
      {
        lineId: "rice",
        quantity,
        available: 12,
        reason: "Coordinator stock recount",
      },
    ],
  });
}
const reconcileApply = (
  packages: { id: string; disposition: string; note: string }[] = [],
) =>
  store.execute("admin", {
    action: "reconciliationApply",
    eventId: manifest.eventId,
    previewId: "revised",
    confirmed: true,
    goodsAccountedFor: true,
    stagingCleared: true,
    workNote: "All loose goods counted and set aside for repacking",
    packages,
  });

test("reconciliation holds work, resets packing, preserves original request and audits revised stock", async () => {
  const { ref, fulfillment, order } = await reconciliationFixture();
  await rejects(
    "reconciliationPending",
    fulfillment.execute("admin", {
      eventId: manifest.eventId,
      orderId: ref.id,
      operationId: "bypass",
      expectedVersion: 3,
      command: { type: "control", state: "active", reason: "Bypass" },
    }),
  );
  await reconcilePreview(order);
  await reconcileApply();
  const next = (await ref.get()).data()!;
  assert.equal(next.version, 4);
  assert.equal(next.control, "active");
  assert.equal(next.reconciliationId, undefined);
  assert.equal(next.portions.advanceDry.state, "queued");
  assert.equal(next.portions.afterArrival.state, "waiting");
  assert.equal(next.allocations.rice.quantity, 3);
  assert.deepEqual(next.manifest.lines, order.manifest.lines);
  assert.equal(
    (await event().collection("allocationItems").doc("rice").get()).data()!
      .allocated,
    11,
  );
  assert.equal(
    (await event().collection("reconciliations").doc("review").get()).data()!
      .before.portions.advanceDry.state,
    "picking",
  );
  await reconcileApply();
  assert.equal((await ref.get()).data()!.version, 4);
});

test("reconciliation rejects stock overruns, inherited keys, remapping and stale budget changes", async () => {
  const { order, ref } = await reconciliationFixture();
  await rejects("allocationOverStock", reconcilePreview(order, 5));
  await rejects(
    "reconciliationAdjustment",
    store.execute("admin", {
      action: "reconciliationPreview",
      eventId: manifest.eventId,
      reviewId: "review",
      operationId: "bad-key",
      manifest: order.manifest,
      adjustments: [
        {
          lineId: "constructor",
          quantity: 1,
          available: 12,
          reason: "Invalid",
        },
      ],
    }),
  );
  await rejects(
    "reconciliationMapping",
    store.execute("admin", {
      action: "reconciliationPreview",
      eventId: manifest.eventId,
      reviewId: "review",
      operationId: "bad-lines",
      manifest: { ...order.manifest, lines: order.manifest.lines.slice(1) },
      adjustments: [],
    }),
  );
  await reconcilePreview(order);
  await event()
    .collection("allocationItems")
    .doc("rice")
    .update({ version: 99 });
  await rejects("staleAllocation", reconcileApply());
  assert.equal((await ref.get()).data()!.control, "held");
  assert.equal((await ref.get()).data()!.allocations.rice.quantity, 4);
});

test("reconciliation cancellation restores work and preserves arrival received during review", async () => {
  const { ref, order } = await reconciliationFixture();
  const arrival = { id: "arrival-test", checkedInAt: now, priority: 1 };
  await ref.update({ arrival, version: 4 });
  await rejects(
    "staleVersion",
    store.execute("admin", {
      action: "reconciliationCancel",
      eventId: manifest.eventId,
      reviewId: "review",
      expectedVersion: 3,
      goodsUnchanged: true,
      reason: "No changes",
    }),
  );
  await store.execute("admin", {
    action: "reconciliationCancel",
    eventId: manifest.eventId,
    reviewId: "review",
    expectedVersion: 4,
    goodsUnchanged: true,
    reason: "Original instructions confirmed",
  });
  const next = (await ref.get()).data()!;
  assert.deepEqual(next.portions.advanceDry, order.portions.advanceDry);
  assert.deepEqual(next.arrival, arrival);
  assert.equal(next.portions.afterArrival.state, "queued");
  assert.equal(next.control, "active");
});

test("reconciliation requires every package disposition and matching staging occupancy", async () => {
  const { ref, order } = await reconciliationFixture();
  const packages = [
    {
      id: "box-1",
      stage: "advanceDry",
      location: "A01",
      custody: null,
      handedOver: false,
    },
  ];
  await ref.update({ packages });
  const held = (await ref.get()).data() as FulfillmentOrder;
  const location = event().collection("locations").doc(fulfillmentKey("A01"));
  await location.set({
    code: "A01",
    count: 2,
    orderId: ref.id,
    active: true,
    capacity: 3,
  });
  await reconcilePreview(held);
  await rejects("reconciliationPackages", reconcileApply());
  const dispositions = [
    {
      id: "box-1",
      disposition: "retainedForRepack",
      note: "Unpacked and contents counted",
    },
  ];
  await rejects("locationCountConflict", reconcileApply(dispositions));
  await location.update({ count: 1 });
  await reconcileApply(dispositions);
  assert.equal((await location.get()).data()!.count, 0);
  assert.equal((await location.get()).data()!.orderId, null);
  assert.deepEqual((await ref.get()).data()!.packages, []);
  const audit = (
    await ref.collection("activity").doc("reconciliation-apply-review").get()
  ).data()!;
  assert.deepEqual(audit.previous.packages, packages);
  assert.deepEqual(audit.packages, dispositions);
  assert.equal(order.arrival, null);
});

test("reconciliation expires previews, rechecks permissions and refuses custody or terminal orders", async () => {
  const { ref, order } = await reconciliationFixture();
  await reconcilePreview(order);
  now = "2026-11-07T17:00:00Z";
  await rejects("draftExpired", reconcileApply());
  await event().collection("staff").doc("admin").update({ active: false });
  await rejects("forbidden", reconcileApply());
  await event().collection("staff").doc("admin").update({ active: true });
  await store.execute("admin", {
    action: "reconciliationCancel",
    eventId: manifest.eventId,
    reviewId: "review",
    expectedVersion: 3,
    goodsUnchanged: true,
    reason: "No physical changes",
  });
  const start = {
    action: "reconciliationStart",
    eventId: manifest.eventId,
    orderId: ref.id,
    operationId: "second",
    expectedVersion: 4,
    reason: "Changed",
  };
  await ref.update({
    packages: [{ id: "box", custody: { uid: "runner" }, handedOver: false }],
  });
  await rejects("reconciliationCustody", store.execute("admin", start));
  await ref.update({ packages: [], control: "departed" });
  await rejects("reconciliationTerminal", store.execute("admin", start));
});

const selectedLine = (
  category: ReconciliationAddition["category"] = "shelfStable",
  item = "Beans",
): Line => ({
  id: `new-${category}`,
  originalRequest: `Please add ${item}`,
  item,
  quantity: 3,
  unit: "can",
  shelf: "Reviewed shelf",
  ...selectionTiming(category),
});
const selectionReview = (
  line: Line,
  category: ReconciliationAddition["category"] = "shelfStable",
  available?: number,
) => ({
  lineId: line.id,
  category,
  reason: "Household requested this item; quantity and stock reviewed",
  stockConfirmed: true as const,
  ...(available === undefined ? {} : { available }),
});
const selectionPreview = (
  order: FulfillmentOrder,
  lines = [selectedLine()],
  additions = lines.map((line) => selectionReview(line)),
  operationId = "revised",
  reviewId = "review",
) =>
  store.execute("admin", {
    action: "reconciliationPreview",
    eventId: manifest.eventId,
    reviewId,
    operationId,
    manifest: { ...order.manifest, lines: [...order.manifest.lines, ...lines] },
    adjustments: [],
    additions,
  });
const beanBudget = () => event().collection("allocationItems").doc("beans");
const seedBeanBudget = (available = 10) =>
  beanBudget().set({
    itemId: "beans",
    item: "Beans",
    unit: "can",
    allocated: 0,
    available,
    version: 1,
    draftId: "beans-approved",
    packingPlanId: "beans-approved",
  });

test("new shelf-stable and perishable selections survive full repack with explicit review audit", async () => {
  const { order, ref } = await reconciliationFixture();
  const categories = [
    "shelfStable",
    "produce",
    "refrigerated",
    "frozen",
    "otherPerishable",
  ] as const;
  const lines = categories.map((category) =>
    selectedLine(category, `New ${category} item`),
  );
  await selectionPreview(
    order,
    lines,
    lines.map((line, i) => selectionReview(line, categories[i])),
  );
  assert.equal(
    (await ref.get()).data()!.manifest.lines.length,
    order.manifest.lines.length,
  );
  await reconcileApply();
  const next = (await ref.get()).data()!;
  assert.deepEqual(next.manifest.lines.slice(-5), lines);
  assert.equal(next.portions.advanceDry.state, "queued");
  assert.equal(next.portions.afterArrival.state, "waiting");
  assert.deepEqual(next.allocations, order.allocations);
  const audit = (
    await ref.collection("activity").doc("reconciliation-apply-review").get()
  ).data()!;
  assert.equal(audit.additions.length, 5);
  assert.equal(audit.additions[1].category, "produce");
  assert.equal(audit.additions[0].stockConfirmed, true);
  assert.deepEqual(audit.previous.manifest, order.manifest);
  await reconcileApply();
  assert.equal(
    (await ref.get()).data()!.manifest.lines.length,
    order.manifest.lines.length + 5,
  );
});

test("new selections require review, unique item identity and correct perishable timing", async () => {
  const { order } = await reconciliationFixture();
  const line = selectedLine();
  await rejects(
    "reconciliationSelections",
    selectionPreview(order, [line], []),
  );
  await rejects(
    "reconciliationSelections",
    selectionPreview(
      order,
      [line],
      [selectionReview(line), selectionReview(line)],
    ),
  );
  await rejects(
    "reconciliationSelectionTiming",
    selectionPreview(order, [line], [selectionReview(line, "produce")]),
  );
  const duplicate = { ...line, item: "  RICE  ", unit: "different-unit" };
  await rejects(
    "reconciliationDuplicateItem",
    selectionPreview(order, [duplicate]),
  );
  await assert.rejects(
    selectionPreview(order, [{ ...line, id: "constructor" }]),
    { name: "ZodError" },
  );
  await assert.rejects(
    store.execute("admin", {
      action: "reconciliationPreview",
      eventId: manifest.eventId,
      reviewId: "review",
      operationId: "invalid-confirmation",
      manifest: { ...order.manifest, lines: [...order.manifest.lines, line] },
      adjustments: [],
      additions: [{ ...selectionReview(line), stockConfirmed: false }],
    }),
    { name: "ZodError" },
  );
  await assert.rejects(
    selectionPreview(order, [{ ...line, storage: "chilled" }]),
    { name: "ZodError" },
  );
});

test("new planned selection adds its share to the released event budget and remains adjustable", async () => {
  const { order, ref } = await reconciliationFixture();
  await seedBeanBudget();
  const line = selectedLine();
  await rejects("reconciliationSelectionBudget", selectionPreview(order));
  await rejects(
    "allocationOverStock",
    selectionPreview(order, [line], [selectionReview(line, "shelfStable", 2)]),
  );
  await rejects(
    "reconciliationSelectionBudget",
    selectionPreview(
      order,
      [{ ...line, unit: "box" }],
      [selectionReview(line, "shelfStable", 10)],
    ),
  );
  await selectionPreview(
    order,
    [line],
    [selectionReview(line, "shelfStable", 10)],
  );
  await reconcileApply();
  const next = (await ref.get()).data() as FulfillmentOrder;
  assert.equal(next.allocations![line.id].quantity, 3);
  assert.equal(next.allocations![line.id].householdKey, "a");
  assert.equal((await beanBudget().get()).data()!.allocated, 3);
  await reconcileApply();
  assert.equal((await beanBudget().get()).data()!.allocated, 3);
  await store.execute("admin", {
    action: "reconciliationStart",
    eventId: manifest.eventId,
    orderId: ref.id,
    operationId: "second-review",
    expectedVersion: next.version,
    reason: "Recount",
  });
  await store.execute("admin", {
    action: "reconciliationPreview",
    eventId: manifest.eventId,
    reviewId: "second-review",
    operationId: "second-preview",
    manifest: next.manifest,
    adjustments: [
      { lineId: line.id, quantity: 2, available: 10, reason: "Reduced stock" },
    ],
  });
  await store.execute("admin", {
    action: "reconciliationApply",
    eventId: manifest.eventId,
    previewId: "second-preview",
    confirmed: true,
    goodsAccountedFor: true,
    stagingCleared: true,
    workNote: "No additional goods moved",
    packages: [],
  });
  assert.equal((await beanBudget().get()).data()!.allocated, 2);
});

test("concurrent new selections cannot spend the same released stock twice", async () => {
  const { order } = await reconciliationFixture();
  await seedBeanBudget(4);
  const orders = await adminDb
    .collection("fulfillmentOrders")
    .where("manifest.eventId", "==", manifest.eventId)
    .get();
  const other = orders.docs.find((doc) => doc.id !== order.manifest.id)!;
  const started = await store.execute("admin", {
    action: "reconciliationStart",
    eventId: manifest.eventId,
    orderId: other.id,
    operationId: "other-review",
    expectedVersion: other.data().version,
    reason: "Additional selection",
  });
  assert.ok("reconciliation" in started && started.reconciliation);
  const line = selectedLine(),
    additions = [selectionReview(line, "shelfStable", 4)];
  await selectionPreview(order, [line], additions);
  await selectionPreview(
    started.reconciliation.order,
    [line],
    additions,
    "other-preview",
    "other-review",
  );
  const results = await Promise.allSettled([
    reconcileApply(),
    store.execute("admin", {
      action: "reconciliationApply",
      eventId: manifest.eventId,
      previewId: "other-preview",
      confirmed: true,
      goodsAccountedFor: true,
      stagingCleared: true,
      workNote: "Goods reviewed",
      packages: [],
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failure = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(failure.reason.code, "staleAllocation");
  assert.equal((await beanBudget().get()).data()!.allocated, 3);
});

test("new plans or arrivals after selection preview force fresh review and cancellation adds nothing", async () => {
  const { order, ref } = await reconciliationFixture();
  await selectionPreview(order);
  await seedBeanBudget();
  await rejects("staleAllocation", reconcileApply());
  await ref.update({ arrival, version: order.version + 1 });
  await rejects("stalePreview", reconcileApply());
  await store.execute("admin", {
    action: "reconciliationCancel",
    eventId: manifest.eventId,
    reviewId: "review",
    expectedVersion: order.version + 1,
    goodsUnchanged: true,
    reason: "Selection withdrawn before goods moved",
  });
  assert.deepEqual((await ref.get()).data()!.manifest, order.manifest);
  assert.equal((await beanBudget().get()).data()!.allocated, 0);
});

test("new perishable selection on a checked-in dry-only order queues only after reviewed apply", async () => {
  const { order, ref } = await reconciliationFixture();
  const dryOnly = {
    ...order.manifest,
    lines: order.manifest.lines.filter((line) => line.stage === "advanceDry"),
  };
  await ref.update({
    manifest: dryOnly,
    arrival,
    "portions.afterArrival": { state: "notRequired", owner: null },
  });
  const current = (await ref.get()).data() as FulfillmentOrder;
  const line = selectedLine("produce", "Pears");
  await selectionPreview(current, [line], [selectionReview(line, "produce")]);
  assert.equal(
    (await ref.get()).data()!.portions.afterArrival.state,
    "notRequired",
  );
  await reconcileApply();
  assert.equal((await ref.get()).data()!.portions.afterArrival.state, "queued");
  assert.deepEqual((await ref.get()).data()!.arrival, arrival);
});

test("new allocated selection binds an order without prior allocations and rejects redirected bindings", async () => {
  await store.execute("admin", setup);
  const imported = await preview();
  await apply();
  const ref = adminDb.doc(`fulfillmentOrders/${imported.rows[0].manifest.id}`);
  const started = await store.execute("admin", {
    action: "reconciliationStart",
    eventId: manifest.eventId,
    orderId: ref.id,
    operationId: "review",
    expectedVersion: 0,
    reason: "Additional item request",
  });
  assert.ok("reconciliation" in started && started.reconciliation);
  const order = started.reconciliation.order;
  await seedBeanBudget();
  const line = selectedLine(),
    additions = [selectionReview(line, "shelfStable", 10)];
  await beanBudget().update({ packingPlanId: null });
  await rejects(
    "reconciliationSelectionBudget",
    selectionPreview(order, [line], additions),
  );
  await beanBudget().update({ packingPlanId: "beans-approved" });
  await selectionPreview(order, [line], additions);
  const binding = event()
    .collection("allocationHouseholds")
    .doc(fulfillmentKey(order.manifest.source.key));
  await binding.set({
    householdKey: order.manifest.source.key,
    orderId: "another-order",
  });
  await rejects("packingHouseholdMismatch", reconcileApply());
  assert.equal((await beanBudget().get()).data()!.allocated, 0);
  await binding.delete();
  await reconcileApply();
  assert.equal((await binding.get()).data()!.orderId, ref.id);
  assert.equal(
    (await ref.get()).data()!.allocations[line.id].householdKey,
    order.manifest.source.key,
  );
});
