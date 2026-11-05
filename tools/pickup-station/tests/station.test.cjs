const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function fixture() {
  const tables = {
    Registrations: [["id", "record_json"]],
    Jobs: [["id", "record_json"]],
    Devices: [["id", "record_json"]],
    Enrollments: [["id", "record_json"]],
  };
  const config = {
    sheetId: "sheet",
    formId: "form",
    staff: ["staff@example.test"],
    admins: ["admin@example.test"],
    events: [{ id: "event", label: "Test pickup", sourceValue: "Saturday" }],
    fields: { name: "1", phone: "2", householdSize: "3", event: "4" },
    printer: { id: 12, dpi: 203, widthIn: 3, heightIn: 2 },
  };
  const props = {
    CONFIG: JSON.stringify(config),
    PRINTNODE_API_KEY: "fake-test-secret",
  };
  let actor = "staff@example.test",
    fetchMode = "success",
    calls = [],
    serial = 0,
    failRegistration = false,
    responses = [],
    sourceTabs = [],
    providerResponse = [];
  function sheet(name) {
    return {
      getLastRow: () => tables[name].length,
      getRange: (row, col, rows, cols) => ({
        getValues: () =>
          tables[name]
            .slice(row - 1, row - 1 + rows)
            .map((r) => r.slice(col - 1, col - 1 + cols)),
        setValues: (values) => {
          if (name === "Registrations" && failRegistration) {
            failRegistration = false;
            throw Error("simulated write failure");
          }
          values.forEach((v, i) => (tables[name][row - 1 + i] = v));
        },
      }),
    };
  }
  const context = vm.createContext({
    Date,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Error,
    encodeURIComponent,
    unescape,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k],
        setProperty: (k, v) => (props[k] = v),
      }),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => actor }),
      getEffectiveUser: () => ({ getEmail: () => actor }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      openById: (id) =>
        id === "source"
          ? {
              getSheets: () =>
                sourceTabs.map((t) => ({
                  getSheetId: () => t.id,
                  getName: () => t.title,
                  getLastRow: () => t.rows.length,
                  getLastColumn: () => t.rows[0].length,
                  getRange: (row, col, count, width) => ({
                    getDisplayValues: () =>
                      t.rows
                        .slice(row - 1, row - 1 + count)
                        .map((r) => r.slice(col - 1, col - 1 + width)),
                  }),
                })),
            }
          : { getSheetByName: sheet },
      flush() {},
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_, text) => [
        ...require("node:crypto").createHash("sha256").update(text).digest(),
      ],
      getUuid: () => {
        serial++;
        return require("node:crypto").randomUUID();
      },
      base64Encode: (s) => Buffer.from(s).toString("base64"),
      Charset: { UTF_8: "utf8" },
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        calls.push({ url, options });
        if (fetchMode === "throw") throw Error("timeout");
        if (options.method === "get")
          return {
            getResponseCode: () => (fetchMode === "fail" ? 401 : 200),
            getContentText: () => JSON.stringify(providerResponse),
          };
        return {
          getResponseCode: () =>
            fetchMode === "fail" ? 401 : fetchMode === "conflict" ? 409 : 201,
          getContentText: () => String(1000 + serial),
        };
      },
    },
    FormApp: {
      openById: () => ({
        getItems: () => [1, 2, 3, 4].map((id) => ({ getId: () => id })),
        getResponses: () => responses,
      }),
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../Code.gs"), "utf8"),
    context,
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../Sheets.gs"), "utf8"),
    context,
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../Operations.gs"), "utf8"),
    context,
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../Access.gs"), "utf8"),
    context,
  );
  const record = {
    id: "form:response",
    eventId: "event",
    revision: 1,
    ...context.normalize_({
      name: "Maria Garcia",
      phone: "(303) 555-0142",
      householdSize: 5,
    }),
  };
  context.save_("Registrations", record);
  return {
    c: context,
    sourceTabs: (value) => (sourceTabs = value),
    providerResponse: (value) => (providerResponse = value),
    props,
    config,
    calls,
    tables,
    record,
    actor: (v) => (actor = v),
    mode: (v) => (fetchMode = v),
    failNextRegistration: () => (failRegistration = true),
    responses: (v) => (responses = v),
    request: (extra = {}) => ({
      id: record.id,
      revision: 1,
      action: "checkin",
      copies: 3,
      token: "request-token-00001",
      arrival: { number: "123", line: "blue", vehicle: "Tan van" },
      ...extra,
    }),
  };
}
test("check-in persists arrival and sends a three-copy ZPL job without leaking contact data to title", () => {
  const f = fixture(),
    result = f.c.requestAction(f.request());
  assert.ok(result.checkedInAt);
  assert.equal(result.job.status, "Submitted");
  assert.equal(f.calls.length, 1);
  const payload = JSON.parse(f.calls[0].options.payload);
  assert.equal(payload.qty, 1);
  assert.equal(payload.expireAfter, 120);
  assert.equal(payload.contentType, "raw_base64");
  assert.match(Buffer.from(payload.content, "base64").toString(), /\^PQ3/);
  assert.doesNotMatch(payload.title, /Maria|303/);
  assert.ok(f.calls[0].options.headers["X-Idempotency-Key"]);
});
test("same request token and distinct simultaneous-arrival tokens produce one arrival job", () => {
  const f = fixture();
  f.c.requestAction(f.request());
  assert.equal(f.c.requestAction(f.request()).reused, true);
  assert.equal(
    f.c.requestAction(f.request({ token: "other-request-00002" })).reused,
    true,
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.c.read_("Jobs").length, 1);
});
test("timeout preserves arrival; retry does not blindly resend", () => {
  const f = fixture();
  f.mode("throw");
  const r = f.c.requestAction(f.request());
  assert.equal(r.job.status, "Outcome unknown");
  assert.ok(r.checkedInAt);
  f.c.requestAction(f.request());
  assert.equal(f.calls.length, 1);
});
test("explicit reprint requires reason and creates separate job after failure", () => {
  const f = fixture();
  f.mode("fail");
  assert.equal(f.c.requestAction(f.request()).job.status, "Failed");
  assert.throws(
    () =>
      f.c.requestAction(
        f.request({ action: "reprint", token: "reprint-token-0001" }),
      ),
    /reason/,
  );
  f.mode("success");
  const r = f.c.requestAction(
    f.request({
      action: "reprint",
      token: "reprint-token-0002",
      reason: "Checked printer; label missing",
    }),
  );
  assert.equal(r.job.status, "Submitted");
  assert.equal(f.calls.length, 2);
});
test("advance printing does not check in; subsequent arrival triggers packing-station print", () => {
  const f = fixture();
  const r = f.c.requestAction(f.request({ action: "advance" }));
  assert.equal(r.checkedInAt, null);
  f.c.requestAction(
    f.request({ action: "advance", token: "advance-token-0002" }),
  );
  assert.equal(f.calls.length, 1);
  f.c.requestAction(f.request({ token: "arrival-token-0003" }));
  assert.equal(f.calls.length, 2);
});
test("recovery after job saved but arrival write failed uses same prepared job", () => {
  const f = fixture();
  f.failNextRegistration();
  assert.throws(() => f.c.requestAction(f.request()), /write failure/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.c.read_("Jobs").length, 1);
  const r = f.c.requestAction(f.request({ token: "another-token-0002" }));
  assert.ok(r.checkedInAt);
  assert.equal(f.calls.length, 1);
  assert.equal(f.c.read_("Jobs").length, 1);
});
test("stale revisions, unauthorized users, invalid copies fail before printing", () => {
  const f = fixture();
  assert.throws(() => f.c.requestAction(f.request({ revision: 2 })), /changed/);
  assert.throws(() => f.c.requestAction(f.request({ copies: 100 })), /copies/);
  f.actor("outsider@example.test");
  assert.throws(() => f.c.listRegistrations("event"), /authorized/);
  assert.throws(() => f.c.requestAction(f.request()), /authorized/);
  assert.equal(f.calls.length, 0);
});
test("token cannot be reused for a different action", () => {
  const f = fixture();
  f.c.requestAction(f.request());
  assert.throws(
    () =>
      f.c.requestAction(
        f.request({ action: "reprint", reason: "replacement label" }),
      ),
    /token/,
  );
});
test("missing data blocks printing but explicit arrival-only is available", () => {
  const f = fixture();
  const r = f.c.read_("Registrations")[0];
  r.errors = ["Missing phone"];
  f.c.save_("Registrations", r);
  assert.throws(() => f.c.requestAction(f.request()), /Needs review/);
  const result = f.c.requestAction(f.request({ action: "checkinOnly" }));
  assert.ok(result.checkedInAt);
  assert.equal(result.job, null);
  assert.equal(f.calls.length, 0);
});
test("user data cannot inject ZPL commands; UTF-8 bytes are retained", () => {
  const f = fixture();
  const z = f.c.renderZpl_(
    { name: "Elena ^XZ ~JA", phone: "3035550142", householdSize: 4 },
    f.config.printer,
    1,
  );
  assert.equal((z.match(/\^XZ/g) || []).length, 1);
  assert.ok(!z.includes("~JA"));
  assert.equal(f.c.hex_("é"), "_C3_A9");
});
test("label dimensions follow DPI and overflow fails visibly", () => {
  const f = fixture();
  assert.match(
    f.c.renderZpl_(f.record, { dpi: 300, widthIn: 3, heightIn: 2 }, 1),
    /\^PW900\n\^LL600/,
  );
  assert.throws(
    () =>
      f.c.renderZpl_(
        { ...f.record, name: "A".repeat(100) },
        f.config.printer,
        1,
      ),
    /too long/,
  );
});
test("provider conflict remains uncertain and needs physical reconciliation", () => {
  const f = fixture();
  f.mode("conflict");
  const r = f.c.requestAction(f.request());
  assert.equal(r.job.status, "Outcome unknown");
  assert.equal(f.c.confirmPrinted(r.job.id).status, "Confirmed by staff");
});
test("import refresh preserves identity, updates revisions and deactivates deleted source records", () => {
  const f = fixture();
  f.actor("admin@example.test");
  let name = "Maria Garcia";
  const response = {
    getId: () => "response",
    getTimestamp: () => new Date("2026-11-01T12:00:00Z"),
    getItemResponses: () =>
      [name, "(303) 555-0142", "5", "Saturday"].map((answer, i) => ({
        getItem: () => ({ getId: () => i + 1 }),
        getResponse: () => answer,
      })),
  };
  f.responses([response]);
  f.c.syncResponses();
  const revision = f.c.read_("Registrations")[0].revision;
  f.c.syncResponses();
  assert.equal(f.c.read_("Registrations").length, 1);
  assert.equal(f.c.read_("Registrations")[0].revision, revision);
  name = "Maria García";
  f.c.syncResponses();
  assert.equal(f.c.read_("Registrations")[0].revision, revision + 1);
  f.responses([]);
  f.c.syncResponses();
  assert.equal(f.c.listRegistrations("event").length, 0);
  assert.throws(() => f.c.requestAction(f.request()), /no longer exists/);
});
test("browser script parses and uses textContent for user-provided values", () => {
  const html = fs.readFileSync(path.join(__dirname, "../Index.html"), "utf8");
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(js);
  assert.ok(!js.includes("innerHTML"));
  assert.match(html, /DEMO · Fictional registrations/);
});

test("a prepared job cannot dispatch outdated fields after a source correction", () => {
  const f = fixture();
  f.failNextRegistration();
  assert.throws(() => f.c.requestAction(f.request()), /write failure/);
  const record = f.c.read_("Registrations")[0];
  record.revision = 2;
  record.phone = "3035550199";
  f.c.save_("Registrations", record);
  const result = f.c.requestAction(
    f.request({ revision: 2, token: "recovery-token-0002" }),
  );
  assert.equal(result.job.status, "Failed");
  assert.equal(f.calls.length, 0);
  assert.ok(result.checkedInAt);
});
test("resume sends only prepared jobs, and cannot resend unknown/submitted output", () => {
  const f = fixture();
  f.failNextRegistration();
  assert.throws(() => f.c.requestAction(f.request()), /write failure/);
  const job = f.c.read_("Jobs")[0];
  f.mode("throw");
  assert.equal(f.c.resumePrint(job.id).status, "Outcome unknown");
  assert.ok(f.c.read_("Registrations")[0].checkedInAt);
  f.c.resumePrint(job.id);
  assert.equal(f.calls.length, 1);
});
test("staff job view exposes action and safe failure explanation, not raw payloads or keys", () => {
  const f = fixture();
  f.c.requestAction(f.request());
  const record = f.c.listRegistrations("event")[0];
  assert.equal(record.lastJob.action, "checkin");
  assert.equal(record.lastJob.zpl, undefined);
  assert.equal(record.lastJob.snapshot, undefined);
  assert.ok(!JSON.stringify(record).includes("fake-test-secret"));
});

function sheetFixture() {
  const f = fixture();
  f.actor("admin@example.test");
  f.config.source = {
    type: "sheets",
    spreadsheetId: "source",
    columns: {
      externalId: "ID#",
      submittedAt: "Date",
      name: "First & Last Name",
      phone: "Phone Number",
      householdSize: "Total in Family",
    },
  };
  f.config.events = [
    { id: "event", label: "Sample pickup", sourceSheetId: 12 },
  ];
  f.props.CONFIG = JSON.stringify(f.config);
  f.headers = [
    "Date",
    "ID#",
    "First & Last Name ",
    "Phone Number ",
    "Total in Family",
  ];
  f.rows = [
    ["10/7/2026 13:05:40", "R100", "Sample Person", "03035550123", "4"],
    ["10/8/2026 14:05:40", "R200", "Sample Duplicate", "3035550111", "2"],
    ["10/9/2026 14:05:40", "R200", "Sample Duplicate", "3035550111", "3"],
  ];
  f.update = (rows) =>
    f.sourceTabs([
      { id: 12, title: "Renamable pickup tab", rows: [f.headers, ...rows] },
    ]);
  f.update(f.rows);
  return f;
}
test("sheet source maps trimmed headers, preserves phone text, and holds repeated IDs", () => {
  const f = sheetFixture(),
    result = f.c.syncResponses();
  assert.equal(result.imported, 2);
  assert.equal(result.duplicateGroups, 1);
  assert.equal(result.needsReview, 1);
  const records = f.c.listRegistrations("event"),
    single = records.find((r) => r.externalId === "R100"),
    duplicate = records.find((r) => r.externalId === "R200");
  assert.equal(single.phone, "03035550123");
  assert.equal(duplicate.reviewRequired, true);
  assert.throws(
    () =>
      f.c.requestAction({
        id: duplicate.id,
        revision: duplicate.revision,
        action: "checkinOnly",
        copies: 1,
        token: "duplicate-token-001",
        arrival: { number: "101", line: "orange", vehicle: "" },
      }),
    /review required/,
  );
});
test("sorting source rows preserves arrival identity and revisions", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  let r = f.c.listRegistrations("event").find((r) => r.externalId === "R100");
  f.c.requestAction({
    id: r.id,
    revision: r.revision,
    action: "checkin",
    copies: 1,
    token: "sheet-arrival-0001",
        arrival: { number: "101", line: "orange", vehicle: "" },
  });
  f.update(f.rows.slice().reverse());
  f.c.syncResponses();
  const next = f.c.listRegistrations("event").find((x) => x.id === r.id);
  assert.equal(next.revision, r.revision);
  assert.ok(next.checkedInAt);
  assert.equal(f.calls.length, 1);
});
test("duplicate selection persists across sorting and is invalidated by new responses", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  let r = f.c.listRegistrations("event").find((r) => r.externalId === "R200");
  const chosen = r.duplicateCandidates.find((c) => c.householdSize === 3);
  f.c.resolveDuplicate({
    id: r.id,
    revision: r.revision,
    groupKey: r.groupKey,
    candidateKey: chosen.key,
    reason: "Coordinator confirmed updated family count",
  });
  f.update(f.rows.slice().reverse());
  f.c.syncResponses();
  r = f.c.listRegistrations("event").find((x) => x.id === r.id);
  assert.equal(r.reviewRequired, false);
  assert.equal(r.householdSize, 3);
  assert.equal(r.duplicateReviewHistory.length, 1);
  f.update([
    ...f.rows,
    ["10/10/2026", "R200", "Sample Duplicate", "3035550111", "5"],
  ]);
  f.c.syncResponses();
  r = f.c.listRegistrations("event").find((x) => x.id === r.id);
  assert.equal(r.reviewRequired, true);
  assert.equal(r.duplicateReviewHistory.length, 1);
  assert.equal(f.calls.length, 0);
});
test("duplicate decisions require coordinator authorization and a current revision", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  const r = f.c.listRegistrations("event").find((r) => r.externalId === "R200"),
    q = {
      id: r.id,
      revision: r.revision,
      groupKey: r.groupKey,
      candidateKey: r.duplicateCandidates[0].key,
      reason: "Confirmed corrected submission",
    };
  f.actor("staff@example.test");
  assert.throws(() => f.c.resolveDuplicate(q), /authorized/);
  f.actor("admin@example.test");
  assert.throws(() => f.c.resolveDuplicate({ ...q, revision: 0 }), /changed/);
});
test("missing IDs and ambiguous headers fail before changing working registrations", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  const before = JSON.stringify(f.tables.Registrations);
  f.update([...f.rows, ["date", "", "No ID", "3035550101", "2"]]);
  assert.throws(() => f.c.syncResponses(), /Missing or invalid ID/);
  assert.equal(JSON.stringify(f.tables.Registrations), before);
  f.headers.push("ID#");
  f.update(f.rows);
  assert.throws(() => f.c.syncResponses(), /ambiguous/);
  assert.equal(JSON.stringify(f.tables.Registrations), before);
});
test("source workbook cannot be configured as writable working workbook", () => {
  const f = sheetFixture();
  f.config.sheetId = "source";
  f.props.CONFIG = JSON.stringify(f.config);
  assert.throws(() => f.c.setupStation(), /must be different/);
  assert.throws(() => f.c.syncResponses(), /must be different/);
});
test("removed arrived source record stays visible for reconciliation and cannot reprint", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  const r = f.c.listRegistrations("event").find((r) => r.externalId === "R100");
  f.c.requestAction({
    id: r.id,
    revision: r.revision,
    action: "checkin",
    copies: 1,
    token: "sheet-arrival-0002",
        arrival: { number: "101", line: "orange", vehicle: "" },
  });
  f.update(f.rows.filter((row) => row[1] !== "R100"));
  f.c.syncResponses();
  const next = f.c.listRegistrations("event").find((x) => x.id === r.id);
  assert.equal(next.sourceMissing, true);
  assert.ok(next.checkedInAt);
  assert.throws(
    () =>
      f.c.requestAction({
        id: next.id,
        revision: next.revision,
        action: "reprint",
        copies: 1,
        token: "sheet-reprint-0002",
        reason: "Test reason",
      }),
    /review required/,
  );
});
test("disabled historical events cannot be selected or imported", () => {
  const f = sheetFixture();
  f.config.events[0].enabled = false;
  f.props.CONFIG = JSON.stringify(f.config);
  assert.equal(f.c.getStation().events.length, 0);
  assert.throws(() => f.c.syncResponses(), /explicitly enable/);
  assert.throws(
    () => f.c.listRegistrations("event"),
    /configured pickup event/,
  );
});
test("an unexpectedly empty source cannot erase an imported pickup list", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  const before = JSON.stringify(f.tables.Registrations);
  f.update([]);
  assert.throws(() => f.c.syncResponses(), /now empty/);
  assert.equal(JSON.stringify(f.tables.Registrations), before);
});
test("same external ID on different event tabs remains independent", () => {
  const f = sheetFixture();
  f.config.events.push({
    id: "later-event",
    label: "Later pickup",
    sourceSheetId: 13,
  });
  f.props.CONFIG = JSON.stringify(f.config);
  f.sourceTabs([
    { id: 12, title: "First", rows: [f.headers, ...f.rows] },
    { id: 13, title: "Second", rows: [f.headers, f.rows[0]] },
  ]);
  f.c.syncResponses();
  const first = f.c
      .listRegistrations("event")
      .find((r) => r.externalId === "R100"),
    second = f.c.listRegistrations("later-event")[0];
  assert.notEqual(first.id, second.id);
  assert.equal(second.reviewRequired, false);
});

test("setup checklist reports disabled event and never exposes the service credential", () => {
  const f = sheetFixture();
  f.config.events[0].enabled = false;
  f.props.CONFIG = JSON.stringify(f.config);
  const result = f.c.getSetupChecklist();
  assert.equal(result.tabs[0].sheetId, 12);
  assert.equal(result.checks.find((c) => c.key === "event").ok, false);
  assert.ok(!JSON.stringify(result).includes("fake-test-secret"));
  assert.equal(f.calls.length, 0);
});
test("coordinator can activate a verified source tab without importing or printing", () => {
  const f = sheetFixture();
  f.config.events[0].enabled = false;
  f.props.CONFIG = JSON.stringify(f.config);
  const setup = f.c.getSetupChecklist(),
    before = JSON.stringify(f.tables.Registrations);
  const result = f.c.configurePickupEvent({
    sourceSheetId: 12,
    label: "Pilot pickup",
    configVersion: setup.configVersion,
    admins: ["attacker@example.test"],
  });
  const saved = JSON.parse(f.props.CONFIG);
  assert.equal(result.eventId, "event");
  assert.equal(saved.events[0].enabled, true);
  assert.deepEqual(saved.admins, ["admin@example.test"]);
  assert.equal(saved.source.spreadsheetId, "source");
  assert.equal(JSON.stringify(f.tables.Registrations), before);
  assert.equal(f.calls.length, 0);
  assert.throws(
    () =>
      f.c.configurePickupEvent({
        sourceSheetId: 12,
        label: "Stale change",
        configVersion: setup.configVersion,
      }),
    /another session/,
  );
});
test("event setup rejects unknown tabs and non-coordinator requests", () => {
  const f = sheetFixture(),
    setup = f.c.getSetupChecklist();
  assert.throws(
    () =>
      f.c.configurePickupEvent({
        sourceSheetId: 99,
        label: "Invalid tab",
        configVersion: setup.configVersion,
      }),
    /no longer exists/,
  );
  f.actor("staff@example.test");
  assert.throws(() => f.c.getSetupChecklist(), /authorized/);
  assert.throws(() => f.c.configurePickupEvent({}), /authorized/);
});
test("provider done means spooled, not physically printed; diagnostics only issue GET", () => {
  const f = fixture(),
    job = f.c.requestAction(f.request()).job;
  f.providerResponse([
    [
      {
        printJobId: job.providerId,
        state: "done",
        createTimestamp: "2026-11-05T12:00:00Z",
      },
      {
        printJobId: job.providerId,
        state: "new",
        createTimestamp: "2026-11-05T11:59:00Z",
      },
    ],
  ]);
  const result = f.c.checkPrintStatus(job.id);
  assert.equal(result.job.providerState, "done");
  assert.equal(result.job.status, "Submitted");
  assert.equal(f.calls.at(-1).options.method, "get");
  assert.equal(f.calls.filter((c) => c.options.method === "post").length, 1);
  const count = f.calls.length;
  f.c.checkPrintStatus(job.id);
  assert.equal(f.calls.length, count);
});
test("service error status preserves physical confirmation and never resends", () => {
  const f = fixture(),
    job = f.c.requestAction(f.request()).job;
  f.c.confirmPrinted(job.id);
  f.providerResponse([
    [
      {
        printJobId: job.providerId,
        state: "error",
        createTimestamp: "2026-11-05T12:00:00Z",
      },
    ],
  ]);
  const result = f.c.checkPrintStatus(job.id);
  assert.equal(result.job.status, "Confirmed by staff");
  assert.equal(result.job.providerState, "error");
  assert.equal(f.calls.filter((c) => c.options.method === "post").length, 1);
});
test("diagnostics fail safely on provider errors, unrelated IDs and missing provider ID", () => {
  const f = fixture(),
    job = f.c.requestAction(f.request()).job;
  f.mode("fail");
  assert.throws(() => f.c.checkPrintStatus(job.id), /outcome has not changed/);
  assert.equal(f.c.read_("Jobs")[0].status, "Submitted");
  f.mode("success");
  f.providerResponse([
    [
      {
        printJobId: 99999,
        state: "done",
        createTimestamp: "2026-11-05T12:00:00Z",
      },
    ],
  ]);
  assert.equal(f.c.checkPrintStatus(job.id).job.providerState, null);
  const j = f.c.read_("Jobs")[0];
  j.providerId = null;
  f.c.save_("Jobs", j);
  const count = f.calls.length;
  f.c.checkPrintStatus(j.id);
  assert.equal(f.calls.length, count);
});

function deviceFixture() {
  const f = fixture();
  f.config.authMode = "devices";
  f.props.CONFIG = JSON.stringify(f.config);
  f.actor("admin@example.test");
  return f;
}
test("one-time device enrollment stores only hashes and permits staff actions without Google sign-in", () => {
  const f = deviceFixture(),
    code = f.c.createDeviceEnrollment({ label: "Car-line iPad 1" }).code;
  f.actor("");
  const session = f.c.enrollDevice(code);
  assert.equal(session.token.length, 64);
  const station = f.c.staffCall(session.token, "getStation", []);
  assert.equal(station.admin, false);
  assert.equal(station.deviceLabel, "Car-line iPad 1");
  const raw = JSON.stringify(f.tables);
  assert.ok(!raw.includes(session.token));
  assert.match(code, /^\d{4}$/);
  assert.ok(f.c.read_("Enrollments").every((e) => Object.values(e).every((v) => v !== code)));
  const result = f.c.staffCall(session.token, "requestAction", [f.request()]);
  assert.ok(result.checkedInAt);
  assert.match(f.c.read_("Registrations")[0].checkedInBy, /^device:/);
  assert.throws(() => f.c.enrollDevice(code), /already used/);
});
test("unpaired browsers and paired iPads cannot invoke coordinator or direct staff endpoints", () => {
  const f = deviceFixture(),
    code = f.c.createDeviceEnrollment({ label: "iPad" }).code;
  f.actor("");
  const token = f.c.enrollDevice(code).token;
  assert.throws(() => f.c.getStation(), /authorized/);
  assert.throws(() => f.c.listRegistrations("event"), /authorized/);
  assert.throws(
    () => f.c.staffCall(token, "syncResponses", []),
    /coordinator controls/,
  );
  assert.throws(
    () => f.c.staffCall(token, "configurePickupEvent", [{}]),
    /coordinator controls/,
  );
  assert.throws(
    () => f.c.createDeviceEnrollment({ label: "bad" }),
    /authorized/,
  );
  assert.throws(
    () => f.c.staffCall("0".repeat(64), "getStation", []),
    /DEVICE_ACCESS_REQUIRED/,
  );
});
test("revocation and expiration deny future device requests without canceling saved arrivals", () => {
  const f = deviceFixture(),
    code = f.c.createDeviceEnrollment({ label: "Lost iPad" }).code;
  f.actor("");
  const token = f.c.enrollDevice(code).token;
  f.c.staffCall(token, "requestAction", [f.request()]);
  f.actor("admin@example.test");
  const d = f.c.listDeviceAccess()[0];
  assert.equal(d.tokenHash, undefined);
  f.c.revokeDevice(d.id);
  f.actor("");
  assert.throws(
    () => f.c.staffCall(token, "getStation", []),
    /DEVICE_ACCESS_REQUIRED/,
  );
  assert.ok(f.c.read_("Registrations")[0].checkedInAt);
});
test("expired enrollment is rejected and device authorization cannot leak to subsequent direct calls", () => {
  const f = deviceFixture(),
    code = f.c.createDeviceEnrollment({ label: "iPad" }).code;
  const enrollment = f.c.read_("Enrollments")[0];
  enrollment.expiresAt = "2000-01-01T00:00:00Z";
  f.c.save_("Enrollments", enrollment);
  f.actor("");
  assert.throws(() => f.c.enrollDevice(code), /expired/);
  f.actor("admin@example.test");
  const newCode = f.c.createDeviceEnrollment({ label: "iPad" }).code;
  f.actor("");
  const token = f.c.enrollDevice(newCode).token;
  f.c.staffCall(token, "getStation", []);
  assert.throws(() => f.c.getStation(), /authorized/);
  const device = f.c.read_("Devices")[0];
  device.expiresAt = "2000-01-01T00:00:00Z";
  f.c.save_("Devices", device);
  assert.throws(
    () => f.c.staffCall(token, "getStation", []),
    /DEVICE_ACCESS_REQUIRED/,
  );
});

test("list ends at the last named row; totals below it are ignored and counted", () => {
  const f = sheetFixture();
  f.update([...f.rows, ["", "", "", "", "9"], ["", "TOTAL", "", "", "9"]]);
  const preview = f.c.previewSheetImport()[0];
  assert.equal(preview.sourceRows, 3);
  assert.equal(preview.lastListRow, 4);
  assert.equal(preview.ignoredAfterList, 2);
  const result = f.c.syncResponses();
  assert.equal(result.imported, 2);
  assert.equal(result.ignoredAfterList, 2);
  assert.ok(f.c.listRegistrations("event").every((r) => r.externalId !== "TOTAL"));
});
test("a nameless row inside the list is imported for review, not used to end the list", () => {
  const f = sheetFixture();
  f.update([
    f.rows[0],
    ["10/7/2026 13:10:00", "R150", "", "3035550199", "3"],
    ...f.rows.slice(1),
    ["", "", "", "", "9"],
  ]);
  const result = f.c.syncResponses();
  assert.equal(result.imported, 3);
  assert.equal(result.ignoredAfterList, 1);
  const nameless = f.c.listRegistrations("event").find((r) => r.externalId === "R150");
  assert.ok(nameless.errors.some((e) => /Name/.test(e)));
});
test("a row without name or ID inside the list still stops the import unchanged", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  const before = JSON.stringify(f.tables.Registrations);
  f.update([f.rows[0], ["", "", "", "", "4"], ...f.rows.slice(1)]);
  assert.throws(() => f.c.syncResponses(), /Missing or invalid ID# at source row 3, inside the list/);
  assert.equal(JSON.stringify(f.tables.Registrations), before);
});

const decode = (call) =>
  Buffer.from(JSON.parse(call.options.payload).content, "base64").toString();
test("check-in requires a 3-digit number and a blue or orange line", () => {
  const f = fixture();
  assert.throws(() => f.c.requestAction(f.request({ arrival: undefined })), /car line/);
  assert.throws(
    () => f.c.requestAction(f.request({ arrival: { number: "12", line: "blue" } })),
    /3-digit/,
  );
  assert.throws(
    () => f.c.requestAction(f.request({ arrival: { number: "123", line: "green" } })),
    /blue or orange/,
  );
  assert.throws(
    () =>
      f.c.requestAction(
        f.request({ arrival: { number: "123", line: "blue", vehicle: "x".repeat(31) } }),
      ),
    /30 characters/,
  );
  assert.equal(f.calls.length, 0);
});
test("arrival label prints number, line and vehicle; arrival is saved with the registration", () => {
  const f = fixture();
  const result = f.c.requestAction(f.request());
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(result.arrival), { number: "123", line: "blue", vehicle: "Tan van" });
  assert.deepEqual(plain(result.job.arrival), plain(result.arrival));
  const zpl = decode(f.calls[0]);
  assert.ok(zpl.includes(f.c.hex_("#123")));
  assert.ok(zpl.includes(f.c.hex_("BLUE")));
  assert.ok(zpl.includes(f.c.hex_("Tan van")));
  assert.ok(!zpl.includes("^FR"));
  const record = f.c.listRegistrations(f.record.eventId).find((r) => r.id === f.record.id);
  assert.equal(record.arrival.number, "123");
});
test("orange line prints as a reversed box so lines differ at a glance", () => {
  const f = fixture();
  const z = f.c.renderZpl_(f.record, f.config.printer, 1, {
    number: "045",
    line: "orange",
    vehicle: "Grey SUV",
  });
  assert.ok(z.includes("^FR"));
  assert.ok(z.includes(f.c.hex_("ORANGE")));
  assert.ok(z.includes(f.c.hex_("#045")));
});
test("two-line name with all arrival fields fits a 3 x 2 inch label at 203 and 300 dpi", () => {
  const f = fixture();
  const r = { name: "Maria Guadalupe Hernandez-Rodriguez", phone: "(303) 555-0142 ext 12", householdSize: 12 };
  const a = { number: "999", line: "orange", vehicle: "Silver minivan with roof rack" };
  for (const dpi of [203, 300])
    assert.match(f.c.renderZpl_(r, { ...f.config.printer, dpi }, 3, a), /\^PQ3/);
});
test("reprint after arrival reuses saved car details unless corrected", () => {
  const f = fixture();
  f.c.requestAction(f.request());
  f.c.requestAction(
    f.request({ action: "reprint", token: "reprint-token-0010", reason: "Jammed roll", arrival: undefined }),
  );
  assert.ok(decode(f.calls[1]).includes(f.c.hex_("#123")));
  f.c.requestAction(
    f.request({
      action: "reprint",
      token: "reprint-token-0011",
      reason: "Wrong number typed",
      arrival: { number: "321", line: "orange", vehicle: "Red truck" },
    }),
  );
  assert.ok(decode(f.calls[2]).includes(f.c.hex_("#321")));
  const record = f.c.listRegistrations(f.record.eventId).find((r) => r.id === f.record.id);
  assert.deepEqual(JSON.parse(JSON.stringify(record.arrival)), { number: "321", line: "orange", vehicle: "Red truck" });
});
test("advance labels do not carry car details", () => {
  const f = fixture();
  f.c.requestAction(f.request({ action: "advance", arrival: undefined }));
  assert.ok(!decode(f.calls[0]).includes(f.c.hex_("#123")));
});

test("server build stamp matches the page stamp", () => {
  const f = fixture();
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "../Index.html"), "utf8");
  assert.equal(f.c.getBuild(), html.match(/const clientBuild = "([^"]+)"/)[1]);
});

test("setup PIN is 4 digits; five wrong PINs cancel waiting PINs", () => {
  const f = deviceFixture();
  const pin = f.c.createDeviceEnrollment({ label: "iPad A" }).code;
  assert.match(pin, /^\d{4}$/);
  f.actor("");
  assert.throws(() => f.c.enrollDevice("12ab"), /4-digit/);
  const wrong = pin === "0000" ? "0001" : "0000";
  for (let i = 0; i < 4; i++) assert.throws(() => f.c.enrollDevice(wrong), /incorrect/);
  assert.throws(() => f.c.enrollDevice(wrong), /Too many incorrect PINs/);
  assert.throws(() => f.c.enrollDevice(pin), /incorrect, expired, or already used/);
  f.actor("admin@example.test");
  const fresh = f.c.createDeviceEnrollment({ label: "iPad A" }).code;
  f.actor("");
  assert.equal(f.c.enrollDevice(fresh).label, "iPad A");
});
test("a correct PIN resets the wrong-attempt count, and waiting PINs never collide", () => {
  const f = deviceFixture();
  const pins = [];
  for (let i = 0; i < 30; i++) pins.push(f.c.createDeviceEnrollment({ label: "iPad " + i }).code);
  assert.equal(new Set(pins).size, pins.length);
  f.actor("");
  const wrong = ["0000", "0001", "0002", "0003", "0004", "0005"].find((x) => !pins.includes(x));
  for (let i = 0; i < 4; i++) assert.throws(() => f.c.enrollDevice(wrong), /incorrect/);
  f.c.enrollDevice(pins[0]);
  for (let i = 0; i < 4; i++) assert.throws(() => f.c.enrollDevice(wrong), /incorrect/);
  assert.equal(f.c.enrollDevice(pins[1]).label, "iPad 1");
});

test("text scales to fill a 2.25 x 1.25 inch label at 300 dpi", () => {
  const f = fixture();
  const p = { ...f.config.printer, dpi: 300, widthIn: 2.25, heightIn: 1.25 };
  const z = f.c.renderZpl_(
    { name: "Avery Sample", phone: "3035550188", householdSize: 7 },
    p, 2, { number: "112", line: "blue", vehicle: "Silver Truck" },
  );
  assert.match(z, /\^PW675\n\^LL375/);
  const heights = [...z.matchAll(/\^A0N,(\d+),(\d+)/g)].map((x) => Number(x[1]));
  assert.ok(Math.max(...heights) >= 70, "car number is large");
  assert.ok(heights.filter((h) => h >= 60).length >= 2, "name is large");
  assert.ok(Math.min(...heights) >= 40, "details stay readable");
  const tops = [...z.matchAll(/\^FO\d+,(\d+)\^A0N,(\d+)/g)].map((x) => Number(x[1]) + Number(x[2]));
  assert.ok(Math.max(...tops) <= 375, "nothing runs off the bottom");
});
test("long name, vehicle and phone still fit the small label", () => {
  const f = fixture();
  const p = { ...f.config.printer, dpi: 300, widthIn: 2.25, heightIn: 1.25 };
  const z = f.c.renderZpl_(
    { name: "Maria Guadalupe Hernandez-Rodriguez", phone: "(303) 555-0142 ext 12", householdSize: 12 },
    p, 1, { number: "045", line: "orange", vehicle: "Silver minivan with roof rack" },
  );
  assert.ok(z.includes("^FR"));
  assert.equal((z.match(/\^FO/g) || []).length, 8);
});

const walkIn = (extra = {}) => ({
  eventId: "event",
  name: "Walk Up Person",
  phone: "",
  householdSize: 4,
  copies: 2,
  token: "walkin-token-000001",
  arrival: { number: "321", line: "orange", vehicle: "Red car" },
  ...extra,
});
test("walk-up becomes a Pre-Packed Pickup: added, checked in and printed once", () => {
  const f = fixture();
  const result = f.c.addWalkIn(walkIn());
  assert.ok(result.checkedInAt);
  assert.equal(result.job.status, "Submitted");
  const again = f.c.addWalkIn(walkIn());
  assert.equal(again.id, result.id);
  assert.equal(again.reused, true);
  assert.equal(f.calls.length, 1);
  const r = f.c.listRegistrations("event").find((x) => x.id === result.id);
  assert.equal(r.walkIn, true);
  assert.equal(r.pickupType, "prepacked");
  assert.equal(r.phone, "No phone");
  assert.equal(r.arrival.number, "321");
  const zpl = decode(f.calls[0]);
  assert.ok(zpl.includes(f.c.hex_("PRE-PACKED PICKUP")));
  assert.ok(zpl.includes(f.c.hex_("Walk Up Person")));
  assert.match(zpl, /\^PQ2/);
});
test("walk-up requires a name, household size, number and an active event", () => {
  const f = fixture();
  assert.throws(() => f.c.addWalkIn(walkIn({ name: " " })), /Name/);
  assert.throws(() => f.c.addWalkIn(walkIn({ householdSize: 0 })), /household size/);
  assert.throws(() => f.c.addWalkIn(walkIn({ arrival: { number: "1", line: "blue" } })), /3-digit/);
  assert.throws(() => f.c.addWalkIn(walkIn({ eventId: "nope" })), /pickup event/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.c.listRegistrations("event").filter((r) => r.walkIn).length, 0);
});
test("refreshing the response sheet keeps walk-ups active", () => {
  const f = sheetFixture();
  f.c.syncResponses();
  const added = f.c.addWalkIn(walkIn({ print: false }));
  f.c.syncResponses();
  f.update(f.rows.slice(1));
  f.c.syncResponses();
  const r = f.c.listRegistrations("event").find((x) => x.id === added.id);
  assert.ok(r && !r.inactive && !r.reviewRequired);
  assert.ok(r.checkedInAt);
});
test("Pre-Packed bar fits a 3 x 2 label with a two-line name and vehicle", () => {
  const f = fixture();
  const z = f.c.renderZpl_(
    { name: "Maria Guadalupe Hernandez-Rodriguez", phone: "No phone", householdSize: 12, pickupType: "prepacked" },
    { ...f.config.printer, dpi: 203, widthIn: 3, heightIn: 2 },
    1,
    { number: "045", line: "orange", vehicle: "Silver minivan with roof rack" },
  );
  assert.equal((z.match(/\^FR/g) || []).length, 2);
});
