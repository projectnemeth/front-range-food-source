import { displayGrid } from "./helpers/pickup-sheet";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planDatedAttendance,
  sourceIdentity,
  DATED_HEADERS,
  rowFormulas,
  lookupTable,
  ROW_KEY,
  LOOKUP_KEY,
  LOOKUP_ROW,
} from "../src/lib/pickup/dated-attendance";
import {
  mergeSource,
  parseSheet,
  type Registration,
} from "../src/lib/pickup/model";
const headers = [
  "",
  "ID#",
  "First & Last Name",
  "Phone Number",
  "Total in Family",
];
const row = ["today", "R1", "Pat Lee", "No phone", 4];
const event = {
  id: "sheet-12",
  label: "Saturday",
  sourceSheetId: 12,
  enabled: true,
};
function registration(): Registration {
  return {
    ...mergeSource(
      "source",
      event,
      "R1",
      parseSheet(headers, [row]).groups.get("R1")!,
    ),
    checkedInAt: "2026-11-21T18:00:00Z",
  };
}
function apply(
  grid: unknown[][],
  plan: ReturnType<typeof planDatedAttendance>,
) {
  const next = grid.map((row) => [...row]);
  const formulas = rowFormulas(plan, grid[0], 12);
  if (plan.migrateKeys)
    next.slice(1).forEach((row) => {
      row[plan.keyColumn] = row[plan.column + 11] || "";
    });
  next[0] ||= [];
  DATED_HEADERS.forEach((value, i) => (next[0][plan.column + i] = value));
  next[0][plan.keyColumn] = ROW_KEY;
  next[0][plan.lookupColumn] = LOOKUP_KEY;
  next[0][plan.rowColumn] = LOOKUP_ROW;
  for (let i = 1; i < plan.rows; i++) {
    next[i] ||= [];
    formulas.fields.forEach(
      (formula, j) => (next[i][plan.column + j] = formula),
    );
    next[i][plan.lookupColumn] = formulas.lookup;
    next[i][plan.rowColumn] = formulas.lookupRow;
  }
  for (const r of plan.appendWalkUps) {
    const row: unknown[] = [];
    formulas.fields.forEach((formula, j) => (row[plan.column + j] = formula));
    row[plan.keyColumn] = r.id;
    row[plan.lookupColumn] = formulas.lookup;
    row[plan.rowColumn] = formulas.lookupRow;
    next.push(row);
  }
  return displayGrid(next, lookupTable([plan]));
}
test("dated attendance finds IDs after sorting and leaves source answers intact", () => {
  const grid = [headers, ["today", "R2", "Kim", "No phone", 2], row];
  const plan = planDatedAttendance("11/21/26", grid, [registration()], "now");
  const next = apply(grid, plan);
  assert.equal(next[2][5], "Arrived");
  assert.equal(next[1][5], "Not imported");
  assert.deepEqual(
    next.map((r) => r.slice(0, 5)),
    grid,
  );
  assert.equal(sourceIdentity(next, 5), sourceIdentity(grid, 5));
});
test("new columns avoid unnamed populated columns, and existing headers are validated", () => {
  const grid = [headers, [...row, "", "", "staff note"]];
  const plan = planDatedAttendance("Saturday", grid, [registration()], "now");
  assert.equal(plan.column, 8);
  assert.deepEqual(apply(grid, plan)[1].slice(0, 8), grid[1]);
  assert.throws(
    () =>
      planDatedAttendance(
        "Saturday",
        [[...headers, "FRFS Attendance"], row],
        [registration()],
        "now",
      ),
    /headers/,
  );
});
test("changed or nonselected duplicate responses cannot inherit another response arrival", () => {
  const other = ["other day", "R1", "Pat Lee", "No phone", 7];
  const next = apply(
    [headers, other, row],
    planDatedAttendance(
      "Saturday",
      [headers, other, row],
      [registration()],
      "now",
    ),
  );
  assert.equal(next[1][5], "Other response selected");
  assert.equal(next[1][6], "");
  assert.equal(next[2][5], "Arrived");
  const changed = [headers, other];
  assert.equal(
    apply(
      changed,
      planDatedAttendance("Saturday", changed, [registration()], "now"),
    )[1][5],
    "Needs review",
  );
});
test("walk-ups use app fields on the dated tab and repeated sync does not append duplicates", () => {
  const walkup = {
    ...registration(),
    id: "walkin:one",
    sourceKind: "walkin" as const,
  };
  const grid = [headers, row];
  const plan = planDatedAttendance(
    "Saturday",
    grid,
    [registration(), walkup],
    "now",
  );
  const first = apply(grid, plan);
  assert.equal(first[2][5], "Arrived");
  assert.equal(first[2][13], "Pat Lee");
  assert.equal(first[2][16], "walkin:one");
  assert.equal(parseSheet(first[0], first.slice(1)).groups.size, 1);
  assert.equal(sourceIdentity(first, 5), sourceIdentity(grid, 5));
  const second = apply(
    first,
    planDatedAttendance("Saturday", first, [registration(), walkup], "later"),
  );
  assert.equal(second.length, 3);
  assert.equal(second[2][12], "later");
  assert.deepEqual(second[0].slice(5, 18), DATED_HEADERS);
});
test("source identity ignores app fields and empty padding but detects sorted source records", () => {
  const grid = [headers, row];
  const padded = [
    headers.concat(DATED_HEADERS),
    [...row, ...Array(13).fill("app")],
    Array(18).fill(""),
  ];
  assert.equal(sourceIdentity(grid, 5), sourceIdentity(padded, 5));
  assert.notEqual(
    sourceIdentity(grid, 5),
    sourceIdentity([headers, [...row.slice(0, 4), 5]], 5),
  );
});

test("sorting after planning cannot attach an arrival to the wrong household", () => {
  const grid = [headers, row, ["today", "R2", "Kim", "No phone", 2]];
  const r = registration();
  const plan = planDatedAttendance(
    "Saturday",
    grid,
    [
      r,
      {
        ...r,
        id: "r2",
        externalId: "R2",
        name: "Kim",
        householdSize: 2,
        checkedInAt: undefined,
      },
    ],
    "now",
    12,
  );
  const sorted = [headers, grid[2], grid[1]];
  const after = apply(sorted, plan);
  assert.equal(after[1][1], "R2");
  assert.equal(after[1][5], "Expected");
  assert.equal(after[2][1], "R1");
  assert.equal(after[2][5], "Arrived");
  assert.ok(rowFormulas(plan, headers, 12).lookup.includes("ROW()"));
});
test("a note on an existing walk-up preserves its identity and never appends a duplicate", () => {
  const r = registration(),
    walkup = { ...r, id: "walkin:one", sourceKind: "walkin" as const };
  const first = apply(
    [headers, row],
    planDatedAttendance("Saturday", [headers, row], [r, walkup], "now", 12),
  );
  first[2][0] = "Staff note: supplied box";
  const plan = planDatedAttendance("Saturday", first, [r, walkup], "later", 12);
  assert.equal(plan.appendWalkUps.length, 0);
  const second = apply(first, plan);
  assert.equal(second[2][0], "Staff note: supplied box");
  assert.equal(second.filter((row) => row[16] === "walkin:one").length, 1);
});
test("legacy duplicate walk-up rows display attendance only once while retaining staff notes", () => {
  const r = registration(),
    walkup = { ...r, id: "walkin:one", sourceKind: "walkin" as const };
  const first = apply(
    [headers, row],
    planDatedAttendance("Saturday", [headers, row], [r, walkup], "now", 12),
  );
  first.push([...first[2]]);
  first[2][0] = "Keep this note";
  const plan = planDatedAttendance("Saturday", first, [r, walkup], "later", 12);
  assert.equal(plan.appendWalkUps.length, 0);
  const next = apply(first, plan);
  assert.equal(next.filter((row) => row[16] === "walkin:one").length, 1);
  assert.equal(next[2][0], "Keep this note");
});

test("lookup identity is case-sensitive and treats wildcard characters literally", () => {
  const r = registration();
  const grid = [
    headers,
    row,
    ["today", "r1", "Pat Lee", "No phone", 4],
    ["today", "R?", "Pat Lee", "No phone", 4],
  ];
  const plan = planDatedAttendance(
    "Saturday",
    grid,
    [
      r,
      { ...r, id: "lower", externalId: "r1", checkedInAt: undefined },
      { ...r, id: "wildcard", externalId: "R?", checkedInAt: undefined },
    ],
    "now",
    12,
  );
  const after = apply(grid, plan);
  assert.equal(after[1][5], "Arrived");
  assert.equal(after[2][5], "Expected");
  assert.equal(after[3][5], "Expected");
  assert.ok(rowFormulas(plan, headers, 12).lookupRow.includes("EXACT("));
});
test("a source edit during export cannot reuse another snapshot’s saved arrival", () => {
  const plan = planDatedAttendance(
    "Saturday",
    [headers, row],
    [registration()],
    "now",
    12,
  );
  const changed = [headers, [...row.slice(0, 4), 5]];
  const after = apply(changed, plan);
  assert.equal(after[1][5], "Needs review");
  assert.equal(after[1][6], "");
});
