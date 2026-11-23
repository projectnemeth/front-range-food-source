// Small Sheets test double for the API operations used by attendance sync.
// Formula results are also verified against native Google Sheets in an isolated fixture.
export function displayGrid(
  grid: unknown[][],
  ledger: unknown[][],
): unknown[][] {
  const result = grid.map((row) => Array.from(row, (value) => value ?? ""));
  const header = (grid[0] || []).map(String),
    start = header.indexOf("FRFS Attendance");
  const lookup = header.indexOf("FRFS Lookup Key"),
    rowKey = header.indexOf("FRFS Row Key"),
    rowColumn = header.indexOf("FRFS Lookup Row");
  if (start < 0 || lookup < 0) return result;
  const names = [
    "Date",
    "ID#",
    "First & Last Name",
    "Phone Number",
    "Total in Family",
  ];
  const headers = header.map((x) => x.trim());
  if (!headers[0]) headers[0] = "Date";
  const columns = names.map((name) => headers.indexOf(name));
  const key = (values: unknown[]) =>
    values
      .map((v) => String(v ?? ""))
      .map((v) => v.length + ":" + v)
      .join("");
  const keys: string[] = [];
  for (let i = 1; i < grid.length; i++) {
    if (!String(grid[i]?.[lookup] || "").startsWith("=")) continue;
    const id = String(grid[i]?.[columns[1]] || ""),
      name = String(grid[i]?.[columns[2]] || "");
    const prefix = String(grid[i][lookup]).match(/"(r:\d+:)"/)?.[1] || "";
    const own = String(grid[i][rowKey] || "");
    const k =
      id && name
        ? prefix + key(columns.map((c) => grid[i][c]))
        : own.startsWith("walkin:")
          ? own
          : "";
    keys[i] = k;
    result[i][lookup] = k;
    const row = ledger.slice(1).find((r) => {
      const formula = String(r[0] || "");
      return formula.startsWith("=")
        ? (formula.match(/^="([^"]+)"/)?.[1] || "") + key(r.slice(14, 19)) === k
        : formula === k;
    });
    if (rowColumn >= 0)
      result[i][rowColumn] = !k ? "" : row ? ledger.indexOf(row) : -1;
    for (let field = 0; field < 13; field++) {
      if (!String(grid[i][start + field] || "").startsWith("=")) continue;
      result[i][start + field] =
        !k || (k.startsWith("walkin:") && keys.indexOf(k) !== i)
          ? ""
          : row
            ? (row[field + 1] ?? "")
            : field === 0
              ? "Needs review"
              : field === 12
                ? "Yes"
                : "";
    }
  }
  return result;
}
export function applyCells(
  grid: unknown[][],
  rows: {
    values?: {
      userEnteredValue?: {
        stringValue?: string;
        numberValue?: number;
        formulaValue?: string;
      };
    }[];
  }[],
  row: number,
  column: number,
) {
  rows.forEach((r, i) => {
    grid[row + i] ||= [];
    r.values?.forEach((cell, j) => {
      const value = cell.userEnteredValue;
      grid[row + i][column + j] =
        value?.formulaValue ?? value?.numberValue ?? value?.stringValue ?? "";
    });
  });
}
