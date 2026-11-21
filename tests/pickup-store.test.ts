import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { NextRequest } from "next/server";
import { adminDb, adminAuth } from "../src/lib/firebase-admin";
import { PickupStore } from "../src/lib/pickup/store";
import {
  key,
  normalize,
  type Registration,
  type Job,
} from "../src/lib/pickup/model";
import {
  createPairing,
  pairDevice,
  device,
  deviceCookie,
  coordinatorRole,
  coordinatorCookie,
} from "../src/lib/pickup/auth";
import { POST } from "../src/app/api/pickup/route";
import { GET as worker } from "../src/app/api/pickup/worker/route";
let env: RulesTestEnvironment;
const store = new PickupStore(adminDb),
  originalFetch = globalThis.fetch;
const request = (method: string, args: unknown[] = [], cookie = "") =>
  new NextRequest("http://localhost/api/pickup", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ method, args }),
  });
const registration: Registration = {
  id: "sheet:source:12:R1",
  eventId: "sheet-12",
  sourceKind: "sheets",
  sourceSheetId: 12,
  externalId: "R1",
  revision: 1,
  ...normalize({ name: "Test Household", phone: "No phone", householdSize: 4 }),
};
const action = (extra: object = {}) => ({
  id: registration.id,
  revision: 1,
  action: "checkin" as const,
  copies: 1,
  token: "checkin-request-0001",
  arrival: { number: "007", line: "blue" as const, vehicle: "Green van" },
  ...extra,
});
let sends = 0,
  printMode = "success",
  googleRows: unknown[][] = [],
  putRows: unknown[][] = [],
  failGoogle = false;
let attendanceExists = true;
before(async () => {
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "demo-food-source");
  env = await initializeTestEnvironment({
    projectId: "demo-food-source",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.PICKUP_GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
    client_email: "test@example.test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  process.env.PICKUP_SOURCE_SPREADSHEET_ID = "source";
  process.env.PICKUP_HOSTED_ENABLED = "true";
  process.env.PICKUP_PRINTER_CONFIG = JSON.stringify({
    id: 12,
    dpi: 203,
    widthIn: 3,
    heightIn: 2,
  });
  process.env.PRINTNODE_API_KEY = "fake-print-key";
});
beforeEach(async () => {
  globalThis.fetch = originalFetch;
  await env.clearFirestore();
  sends = 0;
  printMode = "success";
  googleRows = [];
  putRows = [];
  failGoogle = false;
  attendanceExists = true;
  await adminDb.doc(`pickupEvents/${key("sheet-12")}`).set({
    id: "sheet-12",
    label: "Saturday",
    sourceSheetId: 12,
    enabled: true,
  });
  await store.reg(registration.id).set(registration);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.printnode.com/printjobs")) {
      if (init?.method === "POST") {
        sends++;
        if (printMode === "timeout") throw Error("timeout");
        return Response.json(12345, { status: 201 });
      }
      return Response.json([
        [
          {
            printJobId: 12345,
            state: "done",
            createTimestamp: new Date().toISOString(),
          },
        ],
      ]);
    }
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({
        access_token: "fake-google-token",
        expires_in: 3600,
      });
    if (url.startsWith("https://sheets.googleapis.com/")) {
      if (failGoogle) return Response.json({}, { status: 503 });
      if (url.endsWith(":batchUpdate") && init?.method === "POST") {
        attendanceExists = true;
        return Response.json({
          replies: [
            {
              addSheet: {
                properties: {
                  sheetId: 99,
                  gridProperties: { rowCount: 1000, columnCount: 17 },
                },
              },
            },
          ],
        });
      }
      if (url.includes("?fields="))
        return Response.json({
          sheets: [
            {
              properties: {
                sheetId: 12,
                title: "Saturday",
                gridProperties: { rowCount: 100, columnCount: 24 },
              },
            },
            {
              properties: {
                sheetId: 99,
                title: "FRFS Attendance",
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ].filter(
            (s) => attendanceExists || s.properties.title !== "FRFS Attendance",
          ),
        });
      if (init?.method === "PUT") {
        putRows = JSON.parse(String(init.body)).values;
        return Response.json({ updatedRows: putRows.length });
      }
      if (decodeURIComponent(url).includes("FRFS Attendance"))
        return Response.json({ values: googleRows });
      if (decodeURIComponent(url).includes("A1:"))
        return Response.json({
          values: [
            ["", "ID#", "First & Last Name", "Phone Number", "Total in Family"],
          ],
        });
      return Response.json({
        values: [
          ["today", "R1", "Test Household", "No phone", "4"],
          ["today", "R2", "Second Household", "No phone", "2"],
        ],
      });
    }
    throw Error("Unexpected network request: " + url);
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await env.cleanup();
  await adminDb.terminate();
});
test("concurrent iPads create one arrival and exactly one PrintNode send", async () => {
  const results = await Promise.all([
    store.action(action(), "device:1"),
    store.action(action({ token: "another-request-0002" }), "device:2"),
  ]);
  assert.equal(sends, 1);
  assert.ok(results.every((r) => r.checkedInAt));
  assert.equal((await adminDb.collection("pickupJobs").get()).size, 1);
  assert.equal((await store.list("sheet-12"))[0].arrival!.number, "007");
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    true,
  );
});
test("uncertain dispatch is never retried by a repeated check-in or worker", async () => {
  printMode = "timeout";
  const first = await store.action(
    action({ prepackedReason: "noShow" }),
    "device:1",
  );
  assert.equal(first.job?.status, "Outcome unknown");
  await store.action(action(), "device:1");
  await store.worker();
  assert.equal(sends, 1);
  const r = (await store.reg(registration.id).get()).data();
  assert.equal(r?.previousNoShow, true);
  assert.ok(r?.checkedInAt);
});
test("prepared jobs recover after interruption and outdated source is blocked", async () => {
  await store.action(action({ action: "advance" }), "device:1");
  let j = (await adminDb.collection("pickupJobs").get()).docs[0];
  await j.ref.update({ status: "Prepared" });
  sends = 0;
  await store.reg(registration.id).update({ revision: 2 });
  await store.worker();
  assert.equal(sends, 0);
  assert.equal((await j.ref.get()).data()?.status, "Failed");
});
test("pairing is single use and cookies survive renewed access until revoked", async () => {
  const pairing = await createPairing("Car-line iPad", {
    id: "user:admin",
    admin: true,
  });
  assert.match(pairing.code, /^\d{6}$/);
  const session = await pairDevice(pairing.code, request("enrollDevice"));
  const cookie = deviceCookie() + "=" + session.credential;
  assert.equal(
    (await device(request("getStation", [], cookie))).label,
    "Car-line iPad",
  );
  const id = session.credential.split(".")[0];
  await adminDb
    .doc(`pickupDevices/${id}`)
    .update({ expiresAt: Date.now() + 3600000, lastSeenAt: 0 });
  await device(request("getStation", [], cookie));
  assert.ok(
    (await adminDb.doc(`pickupDevices/${id}`).get()).data()!.expiresAt >
      Date.now() + 170 * 86400000,
  );
  await assert.rejects(
    pairDevice(pairing.code, request("enrollDevice")),
    /already-used/,
  );
  const response = await POST(request("getStation", [], cookie));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(response.headers.get("set-cookie")!, /SameSite=strict/);
  assert.ok(!(await response.text()).includes(session.credential));
  const staleCoordinator = await POST(
    request(
      "getStation",
      [],
      cookie + "; " + coordinatorCookie() + "=expired-session",
    ),
  );
  assert.equal(staleCoordinator.status, 200);
  assert.equal((await staleCoordinator.json()).admin, false);
  await adminDb.doc(`pickupDevices/${id}`).update({ revokedAt: Date.now() });
  assert.equal((await POST(request("getStation", [], cookie))).status, 401);
});
test("unpaired devices, cross-origin mutations and direct Firestore access are denied", async () => {
  assert.equal(
    (await POST(request("listRegistrations", ["sheet-12"]))).status,
    401,
  );
  const foreign = new NextRequest("http://localhost/api/pickup", {
    method: "POST",
    headers: {
      Origin: "https://other.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method: "getStation", args: [] }),
  });
  assert.equal((await POST(foreign)).status, 403);
  await assertFails(
    getDoc(
      doc(
        env.unauthenticatedContext().firestore(),
        "pickupRegistrations",
        key(registration.id),
      ),
    ),
  );
  await assertFails(
    setDoc(
      doc(
        env.authenticatedContext("someone").firestore(),
        "pickupDevices",
        "fake",
      ),
      { active: true },
    ),
  );
});
test("device credentials cannot reach coordinator import, export or pairing controls", async () => {
  const pin = await createPairing("iPad", { id: "user:admin", admin: true }),
    session = await pairDevice(pin.code, request("enrollDevice")),
    cookie = deviceCookie() + "=" + session.credential;
  for (const method of [
    "syncResponses",
    "syncAttendanceToSource",
    "createDeviceEnrollment",
    "configurePickupEvent",
  ])
    assert.equal((await POST(request(method, [], cookie))).status, 401);
  assert.equal((await POST(request("getBootstrap", [], cookie))).status, 200);
});
test("Google import keeps a saved arrival while adding registrations, without printing", async () => {
  await store.action(
    action({ action: "checkinOnly", prepackedReason: "noShow" }),
    "device:1",
  );
  const result = await store.importSource();
  assert.equal(result.imported, 2);
  assert.equal(sends, 0);
  const r = (await store.reg(registration.id).get()).data();
  assert.ok(r?.checkedInAt);
  assert.equal(r?.previousNoShow, true);
});
test("attendance export is an idempotent mirror with retained history and no source-row edits", async () => {
  await store.action(action({ action: "checkinOnly" }), "device:1");
  await store.exportAttendance();
  assert.equal(putRows[1][8], "Arrived");
  assert.equal(putRows[1][12], "007");
  googleRows = putRows;
  await store.addWalkIn(
    {
      eventId: "sheet-12",
      name: "Walk Up",
      phone: "",
      householdSize: 2,
      copies: 1,
      token: "walk-up-token-001",
      arrival: { number: "008", line: "orange", vehicle: "" },
      print: false,
    },
    "device:1",
  );
  await store.exportAttendance();
  assert.equal(putRows.length, 3);
  googleRows = putRows;
  await store.reg(registration.id).delete();
  await store.exportAttendance();
  assert.equal(putRows.length, 3);
});
test("Google outage leaves arrivals saved and export dirty for later retry", async () => {
  await store.action(action({ action: "checkinOnly" }), "device:1");
  await adminDb
    .doc("pickupSync/attendance")
    .set({ enabled: true }, { merge: true });
  failGoogle = true;
  const result = await store.worker();
  assert.equal(result.attendance, "retry pending");
  assert.ok((await store.reg(registration.id).get()).data()?.checkedInAt);
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    true,
  );
  assert.equal(sends, 0);
});
test("coordinator grants are separate from client profiles and can be revoked", async () => {
  await assert.rejects(coordinatorRole("other"), /access/);
  await adminDb.doc("pickupCoordinators/other").set({ active: true });
  assert.equal((await coordinatorRole("other")).admin, true);
  await adminDb.doc("pickupCoordinators/other").update({ active: false });
  await assert.rejects(coordinatorRole("other"), /access/);
});
test("unauthenticated worker cannot dispatch jobs or sync Google Sheets", async () => {
  process.env.CRON_SECRET = "test-worker-secret";
  assert.equal(
    (await worker(new Request("http://localhost/api/pickup/worker"))).status,
    401,
  );
});
test("print-state diagnostics read the provider response without resending", async () => {
  const first = await store.action(action(), "device:1");
  const result = await store.checkPrintStatus(first.job!.id);
  assert.equal(result.providerState, "done");
  assert.equal(result.status, "Submitted");
  assert.equal(sends, 1);
});

test("an arrival during Google export leaves the mirror dirty for a fresh retry", async () => {
  const fetchBefore = globalThis.fetch;
  let changed = false;
  globalThis.fetch = async (input, init) => {
    if (
      String(input).startsWith("https://sheets.googleapis.com/") &&
      init?.method === "PUT" &&
      !changed
    ) {
      changed = true;
      await store.action(action({ action: "checkinOnly" }), "device:late");
    }
    return fetchBefore(input, init);
  };
  await store.exportAttendance();
  assert.equal(putRows[1][8], "Expected");
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    true,
  );
  await store.exportAttendance();
  assert.equal(putRows[1][8], "Arrived");
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    false,
  );
});
test("physical confirmation is preserved when a delayed print-service response arrives", async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (
      String(input) === "https://api.printnode.com/printjobs" &&
      init?.method === "POST"
    ) {
      const jobs = await adminDb.collection("pickupJobs").get();
      await store.confirmPrinted(jobs.docs[0].id);
    }
    return fetchBefore(input, init);
  };
  const result = await store.action(action(), "device:1");
  assert.equal(result.job?.status, "Confirmed by staff");
  assert.equal(sends, 1);
});

test("first attendance export creates its dedicated tab before writing the report", async () => {
  attendanceExists = false;
  await store.exportAttendance();
  assert.equal(attendanceExists, true);
  assert.equal(putRows[0][0], "Registration ID");
  assert.equal(putRows[1][8], "Expected");
});
test("an old never-dispatched label expires instead of printing late", async () => {
  await store.action(action({ action: "advance" }), "device:1");
  const ref = (await adminDb.collection("pickupJobs").get()).docs[0].ref;
  await ref.update({
    status: "Prepared",
    createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
  });
  sends = 0;
  await store.worker();
  assert.equal(sends, 0);
  assert.equal((await ref.get()).data()?.status, "Failed");
});

test("coordinator login works with a role-only admin or a pickup grant and confirms its cookie", async () => {
  const { POST: login, GET: check } =
    await import("../src/app/api/pickup/session/route");
  for (const [uid, role] of [
    ["role-only-admin", "admin"],
    ["pickup-only-coordinator", "coordinator"],
  ]) {
    const email = uid + "@example.test",
      password = "FictionalPassword123!";
    await adminAuth.createUser({ uid, email, password });
    if (role === "admin")
      await adminDb.doc(`users/${uid}`).set({ role: "ADMIN" });
    else await adminDb.doc(`pickupCoordinators/${uid}`).set({ active: true });
    const signed = await originalFetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const token = (await signed.json()).idToken;
    assert.ok(token);
    const response = await login(
      new NextRequest("http://localhost/api/pickup/session", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify({ action: "login" }),
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const confirmation = await check(
      new NextRequest("http://localhost/api/pickup/session", {
        headers: { Cookie: cookie },
      }),
    );
    assert.equal(confirmation.status, 200);
    assert.equal((await confirmation.json()).owner, role === "admin");
  }
});
