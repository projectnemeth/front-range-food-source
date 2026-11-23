import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  newestPickupEvents,
  pickupTabDate,
  pickupYear,
} from "../src/lib/pickup/event-order";
const script = readFileSync("public/pickup-outbox.js", "utf8");
const request = {
  id: "household",
  action: "checkin",
  token: "original-token-1234",
  arrival: { number: "007", line: "blue" },
};
const context = {
  eventId: "november",
  eventLabel: "11/21/26",
  name: "Test Household",
};
const ack = {
  checkedInAt: "2026-11-21T18:00:00Z",
  arrival: request.arrival,
  job: { id: "one-label" },
};
function fixture() {
  const data = new Map();
  let connected = false,
    clock = 1000000,
    failStorage = false;
  const attempts: unknown[] = [];
  let transport = async (_method: string, input: unknown) => {
    attempts.push(structuredClone(input));
    return ack;
  };
  const storage = {
    list: async () => structuredClone([...data.values()]),
    put: async (entry: { token: string }) => {
      if (failStorage) throw Error("Disk full");
      data.set(entry.token, structuredClone(entry));
    },
    remove: async (token: string) => {
      data.delete(token);
    },
  };
  const sandbox = vm.createContext({});
  new vm.Script(script).runInContext(sandbox);
  const make = () =>
    sandbox.FrfsOutbox.create({
      storage,
      send: (...args: [string, unknown]) => transport(...args),
      online: () => connected,
      now: () => clock,
    });
  return {
    make,
    data,
    attempts,
    connect: () => {
      connected = true;
    },
    advance: () => {
      clock += 11 * 60 * 1000;
    },
    failStorage: () => {
      failStorage = true;
    },
    transport: (fn: typeof transport) => {
      transport = fn;
    },
  };
}
test("offline intent survives a new client instance, then replays original token exactly once", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  assert.equal(
    (await client.submit("requestAction", request, context)).queued,
    true,
  );
  assert.equal(f.attempts.length, 0);
  assert.equal(f.data.size, 1);
  const restored = f.make();
  await restored.bind("ipad");
  f.connect();
  await Promise.all([restored.flush(), restored.flush()]);
  assert.equal(f.attempts.length, 1);
  assert.deepEqual(f.attempts[0], request);
  assert.equal(f.data.size, 0);
});
test("lost acknowledgement retains the token and safely retries rather than inventing a new request", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  f.connect();
  let count = 0;
  f.transport(async (_method, input) => {
    f.attempts.push(structuredClone(input));
    if (++count === 1) throw Error("Wi-Fi lost after send");
    return ack;
  });
  assert.equal(
    (await client.submit("requestAction", request, context)).queued,
    true,
  );
  await client.flush();
  assert.equal(f.attempts.length, 2);
  assert.deepEqual(f.attempts[0], f.attempts[1]);
  assert.equal(f.data.size, 0);
});
test("old intents require review; a different iPad authorization never sends them", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  await client.submit("requestAction", request, context);
  f.advance();
  f.connect();
  await client.flush();
  assert.equal(f.data.get(request.token).state, "review");
  assert.equal(f.attempts.length, 0);
  const other = f.make();
  await other.bind("another-ipad");
  await other.flush();
  await assert.rejects(other.retry(request.token), /different iPad/);
  assert.equal(f.data.size, 1);
  await client.retry(request.token);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.data.size, 0);
});
test("validation conflicts stop retrying until reviewed and storage failure never sends", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  f.connect();
  f.transport(async () => {
    throw Object.assign(Error("Registration changed"), { status: 409 });
  });
  await client.submit("requestAction", request, context);
  assert.equal(f.data.get(request.token).state, "review");
  await client.flush();
  assert.equal(f.data.size, 1);
  const g = fixture(),
    broken = g.make();
  await broken.bind("ipad");
  g.connect();
  g.failStorage();
  await assert.rejects(
    broken.submit("requestAction", request, context),
    /Disk full/,
  );
  assert.equal(g.attempts.length, 0);
});
test("walk-up intents retain their event, identity and original token through reconnect", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  const walkup = {
    ...request,
    eventId: "november",
    name: "Walk Up",
    householdSize: 3,
  };
  await client.submit("addWalkIn", walkup, context);
  f.connect();
  await client.flush();
  assert.deepEqual(f.attempts[0], walkup);
  assert.equal(f.data.size, 0);
});
test("latest dated tab comes first across numeric/month labels and year boundaries", () => {
  const events = ["Oct 17", "11/7/2026", "11/21/26", "1/2/2027", "Notes"].map(
    (label, i) => ({ label, id: String(i), sourceSheetId: i, enabled: true }),
  );
  assert.deepEqual(
    newestPickupEvents(events, 2026).map((e) => e.label),
    ["1/2/2027", "11/21/26", "11/7/2026", "Oct 17", "Notes"],
  );
  assert.equal(pickupTabDate("2/30/26", 2026), -1);
});

test("repeated offline taps for the same household retain the first car and token", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  await client.submit("requestAction", request, context);
  await client.submit(
    "requestAction",
    {
      ...request,
      token: "second-token-5678",
      arrival: { number: "008", line: "orange" },
    },
    context,
  );
  assert.equal(f.data.size, 1);
  f.connect();
  await client.flush();
  assert.deepEqual(f.attempts[0], request);
});

test("an already supplied box can sync after a long outage without creating a late label", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  const walkup = {
    ...request,
    eventId: "november",
    name: "Box supplied",
    householdSize: 3,
    print: false,
  };
  await client.submit("addWalkIn", walkup, context);
  f.advance();
  f.connect();
  await client.flush();
  assert.deepEqual(f.attempts[0], walkup);
  assert.equal(f.data.size, 0);
});

test("reviewing a refreshed registration updates its revision and keeps the original idempotency token", async () => {
  const f = fixture(),
    client = f.make();
  await client.bind("ipad");
  f.connect();
  const sent: { revision: number; token: string }[] = [];
  f.transport(async (_method, input) => {
    const value = input as { revision: number; token: string };
    sent.push({ ...value });
    if (value.revision !== 2)
      throw Object.assign(Error("Registration changed"), { status: 409 });
    return ack;
  });
  await client.submit("requestAction", { ...request, revision: 1 }, context);
  assert.equal(f.data.get(request.token).state, "review");
  await client.retry(request.token, { revision: 2 });
  assert.equal(f.data.size, 0);
  assert.deepEqual(
    sent.map((q) => q.revision),
    [1, 2],
  );
  assert.deepEqual(
    sent.map((q) => q.token),
    [request.token, request.token],
  );
});
test("immutable pickup dates prevent yearless historical labels from jumping ahead at New Year", () => {
  const events = [
    {
      id: "old",
      label: "Oct 17",
      pickupDate: "2026-10-17",
      sourceSheetId: 1,
      enabled: true,
    },
    {
      id: "new",
      label: "January pickup",
      pickupDate: "2027-01-02",
      sourceSheetId: 2,
      enabled: true,
    },
  ];
  assert.equal(newestPickupEvents(events, 2027)[0].id, "new");
  assert.equal(newestPickupEvents(events, 2028)[0].id, "new");
});

test("yearless date anchoring uses the Denver year at the UTC year boundary", () => {
  assert.equal(pickupYear(new Date("2027-01-01T01:00:00Z")), 2026);
  assert.equal(pickupYear(new Date("2027-01-01T09:00:00Z")), 2027);
});
