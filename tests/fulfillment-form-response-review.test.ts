import { test } from "node:test";
import { reviewPickupTimestamp } from "../src/lib/fulfillment/pickup-window";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import headers from "../src/lib/fulfillment/form-response-headers.json";
import { reviewFormResponses } from "../src/lib/fulfillment/form-response-review";
import { inspectSourceHeaders } from "../src/lib/fulfillment/source-preflight";
import { formResponseMapping } from "../src/lib/fulfillment/form-response-review";

const row = () => {
  const cells = Array<string>(39).fill("");
  cells[0] = "11/18/2026 10:00:00";
  cells[1] = "007";
  cells[2] = "Fictional household";
  cells[9] = "4";
  cells[14] = "Yes";
  cells[15] = "2";
  cells[16] = "Yes";
  cells[17] = "1";
  cells[19] = "Diapers/ Pañales, Formula /Forma";
  cells[20] = "Fictional formula instruction";
  cells[21] = "4";
  cells[22] = "Fictional special instruction";
  cells[23] = "Rice/arroz";
  cells[27] =
    "Other Dairy (yogurt, etc.)/Otros productos lácteos (yogur), Fresh Fruits/ Frutas frescas";
  cells[32] = "Prepared Meals (Pizza, Lasagna, etc.) / Comidas Preparadas";
  return { rowNumber: 2, cells };
};
const input = () => ({
  snapshot: { sheetTitle: "2025", columnCount: 39, headers },
  rows: [row()],
});

test("observed headers require explicit positional duplicate acknowledgment", () => {
  const value = input();
  assert.equal(reviewFormResponses(value).layout.layoutMatches, true);
  const mapping = structuredClone(formResponseMapping);
  delete mapping.columns[30].allowDuplicateHeader;
  assert.equal(
    inspectSourceHeaders({ snapshot: value.snapshot, mapping }).layoutMatches,
    false,
  );
  mapping.columns[30].allowDuplicateHeader = true;
  value.snapshot.headers = [...headers];
  value.snapshot.headers[31] = headers[9]; // An unacknowledged third occurrence.
  assert.equal(
    inspectSourceHeaders({ snapshot: value.snapshot, mapping }).layoutMatches,
    false,
  );
});

test("review preserves comma-containing cells, dietary and infant details without guessing quantities", () => {
  const value = input(),
    before = structuredClone(value);
  const result = reviewFormResponses(value);
  assert.equal(result.importReady, false);
  const record = result.records[0];
  assert.equal(record.registrationId, "007");
  for (const index of [14, 15, 16, 17, 19, 20, 21, 22, 23, 27, 32])
    assert.equal(
      record.fields.find((f) => f.column === index + 1)!.originalValue,
      value.rows[0].cells[index],
    );
  assert.equal(
    record.fields.find((f) => f.column === 28)!.preparation,
    "afterArrival",
  );
  assert.equal(
    record.fields.find((f) => f.column === 33)!.preparation,
    "afterArrival",
  );
  assert.equal(
    record.fields.find((f) => f.column === 24)!.preparation,
    "advanceDryCandidate",
  );
  assert.ok(record.issues.includes("pickupEventReviewRequired"));
  assert.ok(record.issues.includes("allocationReviewRequired"));
  assert.equal("manifest" in record, false);
  assert.deepEqual(value, before);
});

test("contact values are excluded while conflicting household fields remain visible", () => {
  const value = input();
  for (const index of [3, 4, 5, 6, 7, 8])
    value.rows[0].cells[index] = "PRIVATE-CONTACT-MARKER";
  value.rows[0].cells[30] = "6";
  value.rows[0].cells[31] = "Another fictional name";
  const result = reviewFormResponses(value);
  assert.equal(
    JSON.stringify(result).includes("PRIVATE-CONTACT-MARKER"),
    false,
  );
  assert.deepEqual(result.records[0].householdSizes, {
    original: "4",
    later: "6",
  });
  assert.ok(result.records[0].issues.includes("conflictingHouseholdNames"));
  assert.ok(result.records[0].issues.includes("conflictingHouseholdSizes"));
});

test("header drift aborts extraction instead of reading wrong columns", () => {
  const value = input();
  value.snapshot.headers = [...headers];
  value.snapshot.headers[27] = "Changed question";
  const result = reviewFormResponses(value);
  assert.equal(result.layout.layoutMatches, false);
  assert.deepEqual(result.records, []);
});

test("duplicates, blank identities, unlabeled data and missing requests require review", () => {
  const value = input();
  value.rows.push({ ...row(), rowNumber: 3 });
  value.rows[0].cells[38] = "Unmapped choice";
  let result = reviewFormResponses(value);
  assert.ok(
    result.records.every((r) =>
      r.issues.includes("repeatedRegistrationInSlice"),
    ),
  );
  assert.ok(result.records[0].issues.includes("unlabeledColumnData"));
  assert.deepEqual(result.records[0].unmappedFields, [
    { column: 39, originalValue: "Unmapped choice" },
  ]);
  value.rows = [{ rowNumber: 4, cells: ["", "", "Fictional name"] }];
  result = reviewFormResponses(value);
  assert.ok(result.records[0].issues.includes("missingTimestamp"));
  assert.ok(result.records[0].issues.includes("missingRegistrationId"));
  assert.ok(result.records[0].issues.includes("noItemRequests"));
});

test("blank rows are skipped, locators never resolve identity, and bounded input is enforced", () => {
  const value = input();
  value.rows.push({ rowNumber: 3, cells: ["", " "] });
  assert.equal(reviewFormResponses(value).records.length, 1);
  value.rows.push(row());
  assert.throws(() => reviewFormResponses(value));
  assert.throws(() =>
    reviewFormResponses({
      ...input(),
      rows: Array.from({ length: 51 }, (_, i) => ({
        ...row(),
        rowNumber: i + 2,
      })),
    }),
  );
});

test("review CLI emits a non-pickable report and rejects changed layouts or malformed input", () => {
  const dir = mkdtempSync(join(tmpdir(), "frfs-response-test-"));
  const path = join(dir, "input.json");
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/fulfillment-review-source.ts", path],
      { encoding: "utf8" },
    );
  try {
    writeFileSync(path, JSON.stringify(input()));
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).records[0].importReady, false);
    const value = input();
    value.snapshot.sheetTitle = "wrong";
    writeFileSync(path, JSON.stringify(value));
    result = run();
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout).records, []);
    writeFileSync(path, '{"PRIVATE-MARKER');
    result = run();
    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes("PRIVATE-MARKER"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pickup routing follows first/third Saturdays across long gaps and year boundaries", () => {
  for (const [timestamp, pickup] of [
    ["11/9/2026 09:00:00", "2026-11-21"],
    ["11/17/2026 11:59:00 PM", "2026-11-21"],
    ["11/23/2026 09:00:00", "2026-12-05"],
    ["12/21/2026 09:00:00", "2027-01-02"],
    ["8/25/2026 09:00:00", "2026-09-05"],
  ])
    assert.equal(reviewPickupTimestamp(timestamp).pickupDate, pickup);
  for (const timestamp of [
    "11/8/2026 10:00:00",
    "11/18/2026 10:00:00",
    "11/21/2026 10:00:00",
  ])
    assert.equal(
      reviewPickupTimestamp(timestamp).status,
      "outsideOrderingDates",
    );
  const boundary = reviewPickupTimestamp("11/17/2026 10:00:00");
  assert.ok(boundary.status === "candidate" && boundary.boundaryClockReview);
  const middle = reviewPickupTimestamp("11/12/2026 10:00:00");
  assert.ok(middle.status === "candidate" && !middle.boundaryClockReview);
});

test("invalid or unsupported timestamp formats require review rather than host timezone parsing", () => {
  for (const timestamp of [
    "",
    "2026-11-17",
    "2/30/2026 10:00:00",
    "11/17/2026 25:00:00",
    "11/17/2026 00:00:00 PM",
  ])
    assert.equal(
      reviewPickupTimestamp(timestamp).status,
      "timestampReviewRequired",
    );
  const result = reviewFormResponses(input());
  assert.equal(result.records[0].pickupWindow.status, "outsideOrderingDates");
  assert.ok(result.records[0].issues.includes("outsideOrderingDates"));
});
