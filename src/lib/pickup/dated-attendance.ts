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
export const LOOKUP_TAB = "FRFS Attendance Data";
export const ROW_KEY = "FRFS Row Key";
export const LOOKUP_KEY = "FRFS Lookup Key";
export const LOOKUP_ROW = "FRFS Lookup Row";
export const LOOKUP_HEADERS = [
  LOOKUP_KEY,
  ...DATED_HEADERS,
  "Source Date",
  "Source ID",
  "Source Name",
  "Source Phone",
  "Source Household Size",
];
export const sheetString = (value: unknown) =>
  '"' + String(value ?? "").replace(/"/g, '""') + '"';
export function keyExpression(range: string) {
  return `TEXTJOIN("",FALSE,ARRAYFORMULA(LEN(TO_TEXT(${range}))&":"&TO_TEXT(${range})))`;
}
export function sourceColumns(headers: unknown[]) {
  const names = [
    "Date",
    "ID#",
    "First & Last Name",
    "Phone Number",
    "Total in Family",
  ];
  const cleanHeaders = headers.map(clean);
  if (!cleanHeaders[0]) cleanHeaders[0] = "Date";
  return names.map((name) => cleanHeaders.indexOf(name));
}
export interface DatedPlan {
  title: string;
  column: number;
  columns: number;
  rows: number;
  matched: number;
  walkUps: number;
  sourceIdentity: string;
  keyColumn: number;
  lookupColumn: number;
  rowColumn: number;
  migrateKeys: boolean;
  appendWalkUps: Registration[];
  ledger: { prefix: string; raw: unknown[]; values: unknown[] }[];
}
export function sourceIdentity(grid: unknown[][], column: number) {
  const headers = (grid[0] || []).map(clean);
  const owned = new Set([
    headers.indexOf(ROW_KEY),
    headers.indexOf(LOOKUP_KEY),
    headers.indexOf(LOOKUP_ROW),
  ]);
  const original = grid.map((row) => {
    const cells = Array.from(row)
      .filter(
        (_, i) =>
          (i < column || i >= column + DATED_HEADERS.length) && !owned.has(i),
      )
      .map((value) => value ?? "");
    while (cells.length && clean(cells[cells.length - 1]) === "") cells.pop();
    return cells;
  });
  while (original.length && !original[original.length - 1].length)
    original.pop();
  return JSON.stringify(original);
}
export function rowFormulas(
  plan: Pick<DatedPlan, "keyColumn" | "lookupColumn" | "rowColumn">,
  headers: unknown[],
  sheetId: number,
  ledgerRows = 10002,
) {
  const columns = sourceColumns(headers);
  const at = (column: number) =>
    `INDEX($${columnName(column)}:$${columnName(column)},ROW())`;
  const raw = `{${columns.map(at).join(",")}}`;
  const id = at(columns[1]),
    name = at(columns[2]),
    key = at(plan.keyColumn);
  const lookup = `=IF(AND(LEN(${id}),LEN(${name})),${sheetString("r:" + sheetId + ":")}&${keyExpression(raw)},IF(LEFT(${key},7)="walkin:",${key},""))`;
  const k = at(plan.lookupColumn);
  const first = `MATCH(${k},$${columnName(plan.lookupColumn)}$2:$${columnName(plan.lookupColumn)}$2500,0)+1=ROW()`;
  const row = at(plan.rowColumn);
  const end = Math.max(2, ledgerRows);
  const lookupRow = `=IF(${k}="","",IF(IF(LEFT(${k},7)="walkin:",NOT(${first}),FALSE),"",IFERROR(MATCH(TRUE,ARRAYFORMULA(EXACT(${k},${quote(LOOKUP_TAB)}!$A$2:$A$${end})),0),-1)))`;
  const fields = DATED_HEADERS.map((_, i) => {
    const fallback = i === 0 ? '"Needs review"' : i === 12 ? '"Yes"' : '""';
    return `=IF(${row}="","",IF(${row}=-1,${fallback},IFERROR(INDEX(${quote(LOOKUP_TAB)}!$B$2:$N$${end},${row},${i + 1}),${fallback})))`;
  });
  return { lookup, lookupRow, fields };
}
export function lookupTable(plans: DatedPlan[]) {
  const entries = new Map<string, DatedPlan["ledger"][number]>();
  for (const plan of plans)
    for (const entry of plan.ledger)
      entries.set(JSON.stringify([entry.prefix, entry.raw]), entry);
  return [
    LOOKUP_HEADERS,
    ...[...entries.values()].map((entry, i) => [
      entry.prefix.startsWith("walkin:")
        ? entry.prefix
        : "=" +
          sheetString(entry.prefix) +
          "&" +
          keyExpression(`O${i + 2}:S${i + 2}`),
      ...entry.values,
      ...entry.raw,
    ]),
  ];
}
// Only this encoder may turn app-generated strings into formulas. User data stays literal.
export function enteredCell(value: unknown, formula = false) {
  return {
    userEnteredValue: formula
      ? { formulaValue: String(value) }
      : typeof value === "number"
        ? { numberValue: value }
        : { stringValue: String(value ?? "") },
  };
}
// Plan only app-owned columns. Original answers, IDs, notes and totals are never rewritten.
export function planDatedAttendance(
  title: string,
  grid: unknown[][],
  records: Registration[],
  stamp: string,
  sheetId = records.find((r) => r.sourceSheetId !== undefined)?.sourceSheetId ||
    0,
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
  let nextColumn = Math.max(
    column + DATED_HEADERS.length,
    ...grid.map((row) =>
      row.reduce<number>((last, value, i) => (clean(value) ? i + 1 : last), 0),
    ),
  );
  const findOwned = (header: string) => {
    const found = headers.flatMap((value, i) => (value === header ? [i] : []));
    if (found.length > 1)
      throw new PickupError(409, `Repeated ${header} column in ${title}.`);
    return found[0] ?? nextColumn++;
  };
  const keyColumn = findOwned(ROW_KEY),
    lookupColumn = findOwned(LOOKUP_KEY),
    rowColumn = findOwned(LOOKUP_ROW);
  if (Math.max(keyColumn, lookupColumn, rowColumn) >= 100)
    throw new PickupError(
      409,
      "Attendance helpers exceed the 100-column pilot limit.",
    );
  const columns = sourceColumns(headers);
  const hasResponse = (row: unknown[]) =>
    !!clean(row[columns[1]]) && !!clean(row[columns[2]]);
  const walkupId = (row: unknown[]) => {
    const id = clean(row[keyColumn]) || clean(row[column + 11]);
    return id.startsWith("walkin:") && !hasResponse(row) ? id : "";
  };
  const parsed = parseSheet(
    headers,
    grid.slice(1).map((row) => (walkupId(row) ? [] : row)),
  );
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
  const existing = new Set<string>();
  for (const row of grid.slice(1)) {
    const id = walkupId(row);
    if (id) existing.add(id);
  }
  const walkups = records.filter((r) => r.sourceKind === "walkin");
  const ledger: DatedPlan["ledger"] = [...entries].map(
    ([sourceRow, values]) => ({
      prefix: "r:" + sheetId + ":",
      raw: columns.map((col) => String(grid[sourceRow - 1]?.[col] ?? "")),
      values,
    }),
  );
  for (const r of walkups)
    ledger.push({ prefix: r.id, raw: [], values: cells(r, stamp) });
  return {
    title,
    column,
    columns: Math.max(
      column + DATED_HEADERS.length,
      keyColumn + 1,
      lookupColumn + 1,
      rowColumn + 1,
    ),
    rows: Math.max(2, grid.length),
    matched,
    walkUps: walkups.length,
    sourceIdentity: sourceIdentity(grid, column),
    keyColumn,
    lookupColumn,
    rowColumn,
    migrateKeys: !headers.includes(ROW_KEY),
    appendWalkUps: walkups.filter((r) => !existing.has(r.id)),
    ledger,
  };
}
