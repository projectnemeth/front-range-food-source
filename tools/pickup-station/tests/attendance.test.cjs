const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function fixture() {
  const tabs = new Map(),
    props = {};
  let authorized = true,
    writes = 0,
    fail = false;
  const records = [
    {
      id: "sheet:event:A",
      eventId: "event",
      sourceSheetId: 12,
      externalId: "A",
      name: "Expected Person",
      phone: "3035550100",
      householdSize: 3,
      errors: [],
    },
  ];
  const config = {
    sheetId: "working",
    admins: ["admin@test"],
    source: { type: "sheets", spreadsheetId: "original" },
    events: [{ id: "event", label: "Saturday" }],
  };
  function addTab(name, values = []) {
    const tab = {
      values,
      getLastRow: () => tab.values.length,
      getLastColumn: () =>
        tab.values.length ? Math.max(...tab.values.map((r) => r.length)) : 0,
      getMaxRows: () => 1000,
      getMaxColumns: () => 26,
      insertRowsAfter() {},
      insertColumnsAfter() {},
      getRange: (row, col, count, width) => ({
        getValues: () =>
          tab.values
            .slice(row - 1, row - 1 + count)
            .map((r) => r.slice(col - 1, col - 1 + width)),
        setValues: (data) => {
          if (fail) throw Error("simulated permission failure");
          writes++;
          data.forEach((r, i) => {
            tab.values[row - 1 + i] = Array.from(r);
          });
        },
      }),
    };
    tabs.set(name, tab);
    return tab;
  }
  const c = vm.createContext({
    Date,
    JSON,
    Map,
    Number,
    String,
    Error,
    config_: () => config,
    actor_: () => {
      if (!authorized) throw Error("not authorized");
      return "admin@test";
    },
    locked_: (fn) => fn(),
    read_: () => records,
    now_: () => new Date().toISOString(),
    Session: {
      getEffectiveUser: () => ({
        getEmail: () => (authorized ? "admin@test" : "staff@test"),
      }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        assert.equal(id, "original");
        return { getSheetByName: (n) => tabs.get(n), insertSheet: addTab };
      },
      flush() {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k],
        setProperty: (k, v) => (props[k] = v),
      }),
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../Attendance.gs"), "utf8"),
    c,
  );
  return {
    c,
    records,
    tabs,
    props,
    addTab,
    config,
    writes: () => writes,
    deny: () => (authorized = false),
    fail: () => (fail = true),
  };
}
test("attendance mirror writes expected and arrived, history and walk-ups only to dedicated source-workbook tab", () => {
  const f = fixture();
  f.records.push({
    id: "walkin:event:B",
    eventId: "event",
    name: "Returning Person",
    phone: "No phone",
    householdSize: 2,
    checkedInAt: "2026-11-20T18:00:00Z",
    previousNoShow: true,
    prepackedReason: "noShow",
    pickupType: "prepacked",
    arrival: { number: "007", line: "blue", vehicle: "Green van" },
  });
  f.addTab("Response tab", [["DO NOT CHANGE"], ["original"]]);
  const before = JSON.stringify(f.tabs.get("Response tab").values);
  assert.equal(f.c.syncAttendanceToSource().rows, 2);
  const rows = f.tabs.get("FRFS Attendance").values;
  assert.equal(rows[1][8], "Expected");
  assert.equal(rows[2][8], "Arrived");
  assert.equal(rows[2][10], "Yes");
  assert.equal(rows[2][12], "007");
  assert.equal(JSON.stringify(f.tabs.get("Response tab").values), before);
  assert.ok(f.props.LAST_ATTENDANCE_SYNC);
});
test("export updates same ID without duplicates, preserves prior exported events, and escapes formula text", () => {
  const f = fixture();
  f.c.syncAttendanceToSource();
  f.records[0].checkedInAt = "2026-11-20T18:00:00Z";
  f.records[0].name = '=HYPERLINK("https://example.test")';
  f.c.syncAttendanceToSource();
  let rows = f.tabs.get("FRFS Attendance").values;
  assert.equal(rows.length, 2);
  assert.equal(rows[1][8], "Arrived");
  assert.ok(rows[1][5].startsWith("'="));
  f.records.splice(0, 1, {
    id: "other-event:X",
    eventId: "other",
    name: "Another Person",
    householdSize: 1,
  });
  f.c.syncAttendanceToSource();
  rows = f.tabs.get("FRFS Attendance").values;
  assert.equal(rows.length, 3);
  assert.equal(rows[1][8], "Arrived");
});
test("unauthorized export, unrelated destination layout and service failures do not alter arrivals", () => {
  const f = fixture();
  const before = JSON.stringify(f.records);
  f.addTab("FRFS Attendance", [["Someone else’s data"]]);
  assert.throws(() => f.c.syncAttendanceToSource(), /unexpected layout/);
  assert.equal(f.writes(), 0);
  assert.ok(f.props.ATTENDANCE_SYNC_ERROR);
  f.tabs.delete("FRFS Attendance");
  f.fail();
  assert.throws(() => f.c.syncAttendanceToSource(), /permission/);
  assert.equal(JSON.stringify(f.records), before);
  f.deny();
  assert.throws(() => f.c.syncAttendanceToSource(), /not authorized/);
});
