import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { adminDb } from "../src/lib/firebase-admin";
import { finalizeProfile } from "../src/lib/server/profiles";
import { submitOrder } from "../src/lib/server/orders";
import { publicOrdering } from "../src/lib/server/batches";
let env: RulesTestEnvironment;
const profile = {
  firstName: "Ada",
  lastName: "Tester",
  address: "1 Main St",
  phone: "3035551234",
  county: "Denver",
  foodBankId: "TEST-1",
  familySize: { adults: 2, children: 1, seniors: 0 },
};
const payload = {
  batchId: "batch",
  selectedItems: ["rice", "milkDairy"],
  otherItems: "Note",
  confirmedPickup: true,
  disclaimerAgreed: true,
  disclaimerVersion: "2026-11-03",
  dietaryRestrictions: {
    hasRestrictions: true,
    glutenFreeCount: 1,
    veganCount: 1,
  },
  babyNeeds: {
    hasBaby: true,
    needs: { diapers: true, formula: true },
    details: { diaperSize: "3", formulaType: "Sensitive", other: "Baby note" },
  },
};
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Emulator required");
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "demo-food-source");
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
  await finalizeProfile("family", "family@example.test", profile);
  await adminDb.doc("users/admin").set({ uid: "admin", role: "ADMIN" });
  await adminDb.doc("batches/batch").set({
    id: "batch",
    pickupDate: "2026-11-07",
    status: "OPEN",
    scheduledOpen: "",
    scheduledClose: "",
  });
  await adminDb
    .doc("settings/global")
    .set({ currentBatchId: "batch", isFormOpen: true });
});
test("rules deny anonymous/private access, profile replacement and role escalation", async () => {
  const anon = env.unauthenticatedContext().firestore(),
    user = env.authenticatedContext("family").firestore();
  await assertFails(getDoc(doc(anon, "users/family")));
  await assertSucceeds(getDoc(doc(user, "users/family")));
  await assertFails(getDoc(doc(user, "users/admin")));
  await assertFails(updateDoc(doc(user, "users/family"), { role: "ADMIN" }));
  await assertFails(setDoc(doc(anon, "users/admin"), { role: "USER" }));
});
test("existing admin profile cannot be replaced by finalization", async () => {
  assert.equal(
    (await finalizeProfile("admin", "other@example.test", profile)).replayed,
    true,
  );
  assert.equal((await adminDb.doc("users/admin").get()).data()?.role, "ADMIN");
});
test("parallel registrations reserve normalized unique values", async () => {
  const results = await Promise.allSettled([
    finalizeProfile("a", "a@example.test", {
      ...profile,
      phone: "7205551111",
      firstName: "Other",
      foodBankId: "other",
      address: "99 North St",
    }),
    finalizeProfile("b", "b@example.test", {
      ...profile,
      phone: "(720) 555-1111",
      firstName: "Different",
      foodBankId: "different",
      address: "100 North St",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("ten parallel submissions and a retry create one order", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => submitOrder("family", payload)),
  );
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal((await adminDb.collection("orders").get()).size, 1);
  assert.equal((await submitOrder("family", payload)).id, results[0].id);
  const data = (await adminDb.doc(`orders/${results[0].id}`).get()).data()!;
  assert.deepEqual(data.dryGoodsItems, ["rice"]);
  assert.deepEqual(data.freshGoodsItems, ["milkDairy"]);
  assert.equal(data.userName, "Ada Tester");
  assert.equal(data.babyNeeds.details.formulaType, "Sensitive");
});
test("closed, stale and incomplete-profile requests create no order", async () => {
  await adminDb.doc("settings/global").update({ isFormOpen: false });
  await assert.rejects(submitOrder("family", payload), /orderingClosed/);
  await assert.rejects(
    submitOrder("family", { ...payload, batchId: "old" }),
    /staleBatch/,
  );
  await assert.rejects(submitOrder("missing", payload), /incompleteProfile/);
  assert.equal((await adminDb.collection("orders").get()).size, 0);
});
test("legacy order prevents duplication and gets a reservation", async () => {
  await adminDb
    .doc("orders/legacy")
    .set({ userId: "family", batchId: "batch" });
  assert.equal((await submitOrder("family", payload)).id, "legacy");
  assert.equal(
    (await adminDb.doc("orderReservations/batch/users/family").get()).data()
      ?.orderId,
    "legacy",
  );
});
test("scheduled pickup activates without an admin browser and closes previous batch", async () => {
  await adminDb.doc("batches/next").set({
    id: "next",
    pickupDate: "2026-11-14",
    scheduledOpen: new Date(Date.now() - 60000).toISOString(),
    scheduledClose: new Date(Date.now() + 60000).toISOString(),
    status: "SCHEDULED",
  });
  await adminDb.doc("settings/global").update({ pendingBatchId: "next" });
  const state = await publicOrdering();
  assert.equal(state.currentBatchId, "next");
  assert.equal(state.isFormOpen, true);
  assert.equal(
    (await adminDb.doc("batches/batch").get()).data()?.status,
    "CLOSED",
  );
});
test("direct order and reservation writes are denied; only admin packing edits work", async () => {
  const result = await submitOrder("family", payload);
  const user = env.authenticatedContext("family").firestore(),
    admin = env.authenticatedContext("admin").firestore();
  await assertFails(setDoc(doc(user, "orders/extra"), {}));
  await assertFails(
    setDoc(doc(user, "orderReservations/batch/users/family"), {}),
  );
  await assertSucceeds(
    updateDoc(doc(admin, `orders/${result.id}`), {
      "packingStatus.dryGoods": "PACKED",
    }),
  );
  await assertFails(
    updateDoc(doc(admin, `orders/${result.id}`), { userId: "other" }),
  );
  await assertFails(
    updateDoc(doc(admin, `orders/${result.id}`), {
      "packingStatus.freshGoods": "INVALID",
    }),
  );
});

test("profile HTTP handler requires identity and rejects spoofed UID fields", async () => {
  const { POST } = await import("../src/app/api/finalize-registration/route");
  const anonymous = await POST(
    new Request("http://localhost/api/finalize-registration", {
      method: "POST",
      body: JSON.stringify({ ...profile, uid: "admin" }),
    }),
  );
  assert.equal(anonymous.status, 401);
  const token = await emulatorToken("family");
  const spoof = await POST(
    new Request("http://localhost/api/finalize-registration", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...profile, uid: "admin" }),
    }),
  );
  assert.equal(spoof.status, 400);
  assert.equal((await adminDb.doc("users/admin").get()).data()?.role, "ADMIN");
  const invalid = await POST(
    new Request("http://localhost/api/finalize-registration", {
      method: "POST",
      headers: { Authorization: "Bearer invalid" },
      body: JSON.stringify(profile),
    }),
  );
  assert.equal(invalid.status, 401);
});

async function emulatorToken(uid: string) {
  const { adminAuth } = await import("../src/lib/firebase-admin");
  try {
    await adminAuth.getUser(uid);
  } catch {
    await adminAuth.createUser({ uid, email: `${uid}@example.test` });
  }
  const token = await adminAuth.createCustomToken(uid);
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, returnSecureToken: true }),
    },
  );
  assert.equal(response.ok, true);
  return (await response.json()).idToken as string;
}

test("admin close/reopen preserves batch ID and scheduled creation is idempotent", async () => {
  const { POST } = await import("../src/app/api/admin/settings/route");
  const token = await emulatorToken("admin");
  const call = (body: unknown) =>
    POST(
      new Request("http://localhost/api/admin/settings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
  for (const isFormOpen of [false, true, true, false])
    assert.equal((await call({ action: "toggle", isFormOpen })).status, 200);
  assert.equal(
    (await adminDb.doc("settings/global").get()).data()?.currentBatchId,
    "batch",
  );
  assert.equal((await adminDb.collection("batches").get()).size, 1);
  const future = {
    action: "create",
    pickupDate: "2099-11-07",
    scheduledOpen: "2099-11-03T10:00",
    scheduledClose: "2099-11-04T10:00",
  };
  assert.equal((await call(future)).status, 200);
  assert.equal((await call(future)).status, 200);
  assert.equal(
    (await adminDb.doc("settings/global").get()).data()?.currentBatchId,
    "batch",
  );
  assert.equal((await adminDb.collection("batches").get()).size, 2);
  const ordinary = await emulatorToken("family");
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/admin/settings", {
          method: "POST",
          headers: { Authorization: `Bearer ${ordinary}` },
          body: JSON.stringify({ action: "toggle", isFormOpen: true }),
        }),
      )
    ).status,
    403,
  );
});

test("migration dry run preserves data and reviewed duplicate dispositions are repeatable", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  await adminDb.doc("settings/global").update({ isFormOpen: false });
  await adminDb
    .doc("orders/first")
    .set({ userId: "family", batchId: "batch", pickupDate: "2026-11-07" });
  await adminDb
    .doc("orders/second")
    .set({ userId: "family", batchId: "batch", pickupDate: "2026-11-07" });
  const temp = mkdtempSync(join(tmpdir(), "food-migration-"));
  try {
    const report = join(temp, "report.json"),
      dispositions = join(temp, "dispositions.json");
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/migrate.ts", ...args],
        {
          env: { ...process.env, ORDERING_PAUSED: "true" },
          encoding: "utf8",
          timeout: 30000,
        },
      );
    const invalidMapping = join(temp, "invalid-batches.json");
    writeFileSync(
      invalidMapping,
      JSON.stringify({
        batch: {
          pickupDate: "2026-11-07",
          scheduledOpen: "2026-11-03T10:00:00Z",
          scheduledClose: "badZ",
        },
      }),
    );
    const invalid = run(["--apply", "--batches", invalidMapping]);
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stderr, /Invalid approved batch mapping/);
    const dry = run(["--report", report]);
    assert.equal(dry.status, 1, dry.stderr);
    assert.equal(
      (await adminDb.doc("orderReservations/batch/users/family").get()).exists,
      false,
    );
    const details = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(details.conflicts.length, 1);
    writeFileSync(
      dispositions,
      JSON.stringify({
        "orderReservations/batch/users/family": { orderId: "first" },
      }),
    );
    for (let i = 0; i < 2; i++) {
      const result = run(["--apply", "--dispositions", dispositions]);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal((await adminDb.collection("orders").get()).size, 2);
    assert.equal(
      (await adminDb.doc("orderReservations/batch/users/family").get()).data()
        ?.orderId,
      "first",
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
