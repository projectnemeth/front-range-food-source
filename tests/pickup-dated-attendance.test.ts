import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planDatedAttendance,
  sourceIdentity,
  DATED_HEADERS,
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
  for (const write of plan.data) {
    const start = Number(write.range.match(/![A-Z]+(\d+)/)![1]) - 1;
    write.values.forEach((values, i) => {
      next[start + i] ||= [];
      values.forEach((value, j) => {
        next[start + i][plan.column + j] = value;
      });
    });
  }
  return next;
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
  assert.deepEqual(second[0].slice(5), DATED_HEADERS);
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
