import { clean, parseSheet, PickupError, type Registration } from "./model";
import { quote } from "./google";
export const DATED_HEADERS = [
  "FRFS Attendance",
  "FRFS Checked In At (UTC)",
  "FRFS Previous No-Show",
  "FRFS Pickup Type",
  "FRFS Car Number",
  "FRFS Car Line",
  "FRFS Vehicle",
  "FRFS Last Synced At (UTC)",
  "FRFS Name",
  "FRFS Phone",
  "FRFS Household Size",
  "FRFS Registration ID",
  "FRFS Needs Review",
];
export function columnName(index: number) {
  let text = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    text = String.fromCharCode(65 + ((n - 1) % 26)) + text;
  return text;
}
function cells(r: Registration, stamp: string, status?: string): unknown[] {
  return [
    status || (r.checkedInAt ? "Arrived" : "Expected"),
    r.checkedInAt || "",
    r.previousNoShow || r.prepackedReason === "noShow" ? "Yes" : "No",
    r.pickupType === "prepacked"
      ? r.prepackedReason === "noShow"
        ? "Pre-Packed / Previous No-Show"
        : "Pre-Packed / Walk Up"
      : "Registered",
    r.arrival?.number || "",
    r.arrival?.line || "",
    r.arrival?.vehicle || "",
    stamp,
    r.name,
    r.phone,
    r.householdSize ?? "",
    r.id,
    r.reviewRequired || r.errors.length || status === "Needs review"
      ? "Yes"
      : "No",
  ];
}
export interface DatedPlan {
  title: string;
  column: number;
  columns: number;
  rows: number;
  matched: number;
  walkUps: number;
  data: { range: string; values: unknown[][] }[];
  sourceIdentity: string;
}
export function sourceIdentity(grid: unknown[][], column: number) {
  const original = grid.map((row) => {
    const cells = Array.from(row)
      .filter((_, i) => i < column || i >= column + DATED_HEADERS.length)
      .map((value) => value ?? "");
    while (cells.length && clean(cells[cells.length - 1]) === "") cells.pop();
    return cells;
  });
  while (original.length && !original[original.length - 1].length)
    original.pop();
  return JSON.stringify(original);
}
// Plan only app-owned columns. Original answers, IDs, notes and totals are never rewritten.
export function planDatedAttendance(
  title: string,
  grid: unknown[][],
  records: Registration[],
  stamp: string,
): DatedPlan {
  const headers = (grid[0] || []).map(clean),
    matches = headers.flatMap((x, i) => (x === DATED_HEADERS[0] ? [i] : []));
  if (matches.length > 1)
    throw new PickupError(
      409,
      `Repeated FRFS Attendance headers in ${title}. Review the tab before syncing.`,
    );
  let column = matches[0];
  if (column === undefined) {
    column = grid.reduce(
      (last, row) =>
        row.reduce<number>(
          (n, value, i) => (clean(value) ? Math.max(n, i + 1) : n),
          last,
        ),
      0,
    );
  } else if (DATED_HEADERS.some((name, i) => headers[column + i] !== name))
    throw new PickupError(
      409,
      `The FRFS attendance columns in ${title} were changed. Restore their headers before syncing.`,
    );
  if (column + DATED_HEADERS.length > 100)
    throw new PickupError(
      409,
      "Attendance columns exceed the pilot's 100-column limit.",
    );
  const parsed = parseSheet(headers, grid.slice(1));
  const entries = new Map<number, unknown[]>(),
    byId = new Map(
      records
        .filter((r) => r.sourceKind === "sheets")
        .map((r) => [r.externalId, r]),
    );
  let matched = 0;
  for (const [externalId, candidates] of parsed.groups) {
    const r = byId.get(externalId);
    for (const c of candidates) {
      const same =
        !!r &&
        r.name === c.name &&
        r.phone === c.phone &&
        r.householdSize === c.householdSize &&
        (!r.sourceSubmittedAt || r.sourceSubmittedAt === c.submittedAt);
      if (!r) {
        entries.set(c.sourceRow, [
          "Not imported",
          "",
          "",
          "",
          "",
          "",
          "",
          stamp,
          c.name,
          c.phone,
          c.householdSize ?? "",
          "",
          "Yes",
        ]);
        continue;
      }
      if (r.reviewRequired || !same) {
        const status =
          !r.reviewRequired && candidates.length > 1
            ? "Other response selected"
            : "Needs review";
        const value = cells(
          {
            ...r,
            name: c.name,
            phone: c.phone,
            householdSize: c.householdSize,
            checkedInAt: same ? r.checkedInAt : undefined,
            arrival: same ? r.arrival : null,
          },
          stamp,
          status,
        );
        entries.set(c.sourceRow, value);
      } else entries.set(c.sourceRow, cells(r, stamp));
      matched++;
    }
  }
  let lastOriginal = 1;
  const occupied = new Set<number>(),
    existingWalkUps = new Map<string, number>();
  grid.slice(1).forEach((row, i) => {
    const number = i + 2,
      original = row.some(
        (value, col) =>
          (col < column || col >= column + DATED_HEADERS.length) &&
          clean(value),
      );
    if (original) lastOriginal = number;
    const id = clean(row[column + 11]);
    if (id) {
      occupied.add(number);
      if (id.startsWith("walkin:") && !original) {
        if (existingWalkUps.has(id))
          throw new PickupError(
            409,
            `Repeated walk-up row in ${title}; review before syncing.`,
          );
        existingWalkUps.set(id, number);
      }
    }
  });
  let next = lastOriginal + 1,
    walkUps = 0;
  for (const r of records.filter((r) => r.sourceKind === "walkin")) {
    let row = existingWalkUps.get(r.id);
    if (!row) {
      while (occupied.has(next) || entries.has(next)) next++;
      row = next++;
    }
    entries.set(row, cells(r, stamp));
    occupied.add(row);
    walkUps++;
  }
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const data: { range: string; values: unknown[][] }[] = [
    {
      range: `${quote(title)}!${columnName(column)}1:${columnName(column + DATED_HEADERS.length - 1)}1`,
      values: [DATED_HEADERS],
    },
  ];
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end][0] === sorted[end - 1][0] + 1)
      end++;
    data.push({
      range: `${quote(title)}!${columnName(column)}${sorted[i][0]}:${columnName(column + DATED_HEADERS.length - 1)}${sorted[end - 1][0]}`,
      values: sorted.slice(i, end).map(([, row]) => row),
    });
    i = end;
  }
  return {
    title,
    column,
    columns: column + DATED_HEADERS.length,
    rows: Math.max(1, ...sorted.map(([row]) => row)),
    matched,
    walkUps,
    data,
    sourceIdentity: sourceIdentity(grid, column),
  };
}
