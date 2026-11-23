import { LOOKUP_VERSION } from "../src/lib/pickup/dated-attendance";
import { displayGrid, applyCells } from "./helpers/pickup-sheet";
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
import { key, normalize, type Registration } from "../src/lib/pickup/model";
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
let sourceGrid: unknown[][] = [];
let lookupRows: unknown[][] = [];
let lookupExists = false;
const displayed = () => displayGrid(sourceGrid, lookupRows);
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
  lookupRows = [];
  lookupExists = false;
  sourceGrid = [
    ["", "ID#", "First & Last Name", "Phone Number", "Total in Family"],
    ["today", "R1", "Test Household", "No phone", "4"],
    ["today", "R2", "Second Household", "No phone", "2"],
  ];
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
        const body = JSON.parse(String(init.body)),
          replies: unknown[] = [];
        for (const r of body.requests) {
          if (r.addSheet) {
            const lookup =
              r.addSheet.properties.title === "FRFS Attendance Data";
            if (lookup) lookupExists = true;
            else attendanceExists = true;
            replies.push({
              addSheet: {
                properties: {
                  sheetId: lookup ? 100 : 99,
                  gridProperties: {
                    rowCount: 10002,
                    columnCount: lookup ? 19 : 17,
                  },
                },
              },
            });
          } else {
            replies.push({});
            if (r.repeatCell?.range.sheetId === 100) lookupRows = [];
            if (r.copyPaste) {
              const { source, destination } = r.copyPaste;
              const current = displayed();
              for (
                let row = source.startRowIndex;
                row < source.endRowIndex;
                row++
              ) {
                sourceGrid[row] ||= [];
                sourceGrid[row][destination.startColumnIndex] =
                  current[row]?.[source.startColumnIndex] || "";
              }
            }
            if (r.updateCells) {
              const op = r.updateCells,
                start = op.start || {
                  sheetId: op.range.sheetId,
                  rowIndex: op.range.startRowIndex,
                  columnIndex: op.range.startColumnIndex,
                };
              if (start.sheetId === 12)
                assert.ok(
                  start.columnIndex >= 5,
                  "Never overwrite Form answers",
                );
              applyCells(
                start.sheetId === 100 ? lookupRows : sourceGrid,
                op.rows,
                start.rowIndex,
                start.columnIndex,
              );
            }
            if (r.appendCells)
              applyCells(sourceGrid, r.appendCells.rows, sourceGrid.length, 0);
          }
        }
        return Response.json({ replies });
      }
      if (url.includes("?fields="))
        return Response.json({
          sheets: [
            ...(lookupExists
              ? [
                  {
                    properties: {
                      sheetId: 100,
                      title: "FRFS Attendance Data",
                      gridProperties: { rowCount: 10002, columnCount: 19 },
                    },
                  },
                ]
              : []),
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
      if (decodeURIComponent(url).includes("FRFS Attendance Data"))
        return Response.json({ values: lookupRows });
      if (decodeURIComponent(url).includes("FRFS Attendance"))
        return Response.json({ values: googleRows });
      const range = decodeURIComponent(url).split("!")[1]?.split("?")[0] || "";
      if (/^A1:[A-Z]+1$/.test(range))
        return Response.json({ values: [displayed()[0]] });
      if (range.startsWith("A1:"))
        return Response.json({ values: structuredClone(displayed()) });
      return Response.json({ values: structuredClone(displayed().slice(1)) });
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
  const j = (await adminDb.collection("pickupJobs").get()).docs[0];
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
test("attendance export mirrors dated tabs, preserves answers and retains summary history", async () => {
  await store.action(action({ action: "checkinOnly" }), "device:1");
  await store.exportAttendance();
  assert.equal(putRows[1][8], "Arrived");
  assert.equal(sourceGrid[0][5], "FRFS Attendance");
  assert.equal(displayed()[1][5], "Arrived");
  assert.deepEqual(sourceGrid[1].slice(0, 5), [
    "today",
    "R1",
    "Test Household",
    "No phone",
    "4",
  ]);
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
  assert.equal(sourceGrid[0][5], "FRFS Attendance");
  assert.equal(displayed()[1][5], "Arrived");
  assert.deepEqual(sourceGrid[1].slice(0, 5), [
    "today",
    "R1",
    "Test Household",
    "No phone",
    "4",
  ]);
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

test("the same household ID in another event cannot change this dated tab attendance", async () => {
  await store.exportDatedAttendance(
    [
      registration,
      {
        ...registration,
        id: "other-event-registration",
        eventId: "sheet-13",
        sourceSheetId: 13,
        checkedInAt: "2026-11-21T18:00:00Z",
      },
    ],
    [{ id: "sheet-12", label: "Saturday", sourceSheetId: 12, enabled: true }],
    "now",
  );
  assert.equal(displayed()[1][5], "Expected");
  assert.equal(displayed()[1][6], "");
});

test("a source sort detected before writing leaves arrivals queued without updating dated cells", async () => {
  await store.action(action({ action: "checkinOnly" }), "device:1");
  const fetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (input, init) => {
    const url = decodeURIComponent(String(input));
    if (url.includes("'Saturday'!A1:X100") && ++reads === 2) {
      [sourceGrid[1], sourceGrid[2]] = [sourceGrid[2], sourceGrid[1]];
    }
    return fetch(input, init);
  };
  await assert.rejects(store.exportAttendance(), /Source rows changed/);
  assert.equal(sourceGrid[0][5], undefined);
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    true,
  );
});

test("a walk-up is written to its dated tab by automatic attendance sync without enabling a schedule", async () => {
  const created = await store.addWalkIn(
    {
      eventId: "sheet-12",
      name: "Walk Up",
      phone: "",
      householdSize: 3,
      copies: 1,
      token: "automatic-walk-up-token",
      arrival: { number: "009", line: "blue", vehicle: "" },
      print: false,
    },
    "device:1",
  );
  assert.equal(await store.syncAttendance(), "synced");
  const row = displayed().find((row) => row.includes(created.id));
  assert.ok(row);
  assert.equal(row[5], "Arrived");
  assert.equal(row[8], "Pre-Packed / Walk Up");
  assert.equal(row[13], "Walk Up");
  assert.equal(row[15], 3);
  assert.equal(sends, 0);
});

test("enabled pickup events default to the newest dated tab", async () => {
  await adminDb
    .doc(`pickupEvents/${key("sheet-12")}`)
    .update({ label: "Oct 17" });
  await adminDb.doc(`pickupEvents/${key("sheet-13")}`).set({
    id: "sheet-13",
    label: "11/21/26",
    sourceSheetId: 13,
    enabled: true,
  });
  assert.equal((await store.events())[0].id, "sheet-13");
});

test("automatic attendance batches recent changes without clearing pending walk-ups", async () => {
  await adminDb
    .doc("pickupSync/attendance")
    .set({
      dirty: true,
      lastSync: new Date().toISOString(),
      lookupVersion: LOOKUP_VERSION,
    });
  assert.equal(await store.syncAttendance(), "waiting for next refresh");
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    true,
  );
  assert.equal(putRows.length, 0);
});

test("an archived missing source tab cannot block attendance for the current pickup", async () => {
  const old = {
    ...registration,
    id: "walkin:historical",
    eventId: "archived",
    sourceKind: "walkin" as const,
    checkedInAt: "2026-10-17T18:00:00Z",
  };
  await store.reg(old.id).set(old);
  await adminDb.doc(`pickupEvents/${key("archived")}`).set({
    id: "archived",
    label: "Oct 17",
    sourceSheetId: 999,
    enabled: false,
  });
  await store.action(action({ action: "checkinOnly" }), "device:1");
  const result = await store.exportAttendance();
  assert.equal(displayed()[1][5], "Arrived");
  assert.ok(putRows.some((row) => row[0] === old.id));
  assert.equal(result.dated.warnings.length, 1);
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    false,
  );
});
test("a missing active tab leaves a visible retry warning while other events still export", async () => {
  await store.reg("walkin:missing").set({
    ...registration,
    id: "walkin:missing",
    eventId: "missing",
    sourceKind: "walkin",
  });
  await adminDb.doc(`pickupEvents/${key("missing")}`).set({
    id: "missing",
    label: "Missing pickup",
    sourceSheetId: 999,
    enabled: true,
  });
  await store.action(action({ action: "checkinOnly" }), "device:1");
  const result = await store.exportAttendance();
  assert.equal(displayed()[1][5], "Arrived");
  assert.equal(result.dated.retryRequired, true);
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.dirty,
    true,
  );
});
test("a sort immediately before the atomic write cannot move an arrival onto another household", async () => {
  await store.action(action({ action: "checkinOnly" }), "device:1");
  const fetch = globalThis.fetch;
  let sorted = false;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith(":batchUpdate") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (
        !sorted &&
        body.requests.some((r: { copyPaste?: unknown }) => r.copyPaste)
      ) {
        [sourceGrid[1], sourceGrid[2]] = [sourceGrid[2], sourceGrid[1]];
        sorted = true;
      }
    }
    return fetch(input, init);
  };
  await assert.rejects(store.exportAttendance(), /Source rows changed/);
  assert.equal(displayed()[1][1], "R2");
  assert.equal(displayed()[1][5], "Not imported");
  assert.equal(displayed()[2][1], "R1");
  assert.equal(displayed()[2][5], "Arrived");
  await store.exportAttendance();
  assert.equal(displayed()[2][5], "Arrived");
});
test("reviewed offline check-in uses the updated revision without a second print on retry", async () => {
  await store.reg(registration.id).update({ revision: 2 });
  await assert.rejects(
    store.action(action(), "device:1"),
    /Registration changed/,
  );
  await store.action(action({ revision: 2 }), "device:1");
  const again = await store.action(action({ revision: 2 }), "device:1");
  assert.equal(again.reused, true);
  assert.equal(sends, 1);
});
test("legacy pickup dates are anchored to event creation, rather than changing every January", async () => {
  await adminDb
    .doc(`pickupEvents/${key("sheet-12")}`)
    .update({ label: "Oct 17" });
  const event = (await store.events())[0];
  const created = (
    await adminDb.doc(`pickupEvents/${key("sheet-12")}`).get()
  ).createTime!.toDate();
  const year = Number(
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      timeZone: "America/Denver",
    }).format(created),
  );
  assert.equal(event.pickupDate, `${year}-10-17`);
});

test("the first post-deployment refresh upgrades clean legacy attendance without needing a new arrival", async () => {
  await adminDb
    .doc("pickupSync/attendance")
    .set({ dirty: false, lastSync: new Date().toISOString() });
  assert.equal(await store.syncAttendance(), "synced");
  assert.equal(
    (await adminDb.doc("pickupSync/attendance").get()).data()?.lookupVersion,
    LOOKUP_VERSION,
  );
  assert.equal(displayed()[0].includes("FRFS Lookup Row"), true);
  assert.equal(await store.syncAttendance(), "not pending");
});
