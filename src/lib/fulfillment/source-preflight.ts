import { createHash } from "node:crypto";
import { z } from "zod";

const label = z.string().trim().min(1).max(200);
const role = z.enum([
  "responseTimestamp",
  "registrationId",
  "householdLabel",
  "request",
  "dietary",
  "notes",
  "ignore",
]);
export const sourcePreflightSchema = z
  .object({
    snapshot: z
      .object({
        // The reader must supply metadata and the complete header row, not data rows.
        sheetTitle: label,
        columnCount: z.number().int().min(1).max(500),
        headers: z.array(z.string().max(1000).nullable()).max(500),
      })
      .strict()
      .refine(
        (s) => s.headers.length <= s.columnCount,
        "Headers exceed grid width",
      ),
    mapping: z
      .object({
        version: label,
        sheetTitle: label,
        columnCount: z.number().int().min(1).max(500),
        columns: z
          .array(
            z
              .object({
                index: z.number().int().min(0).max(499),
                header: label,
                role,
                // Required even for ignored fields so omissions are deliberate and reviewable.
                reason: z.string().trim().min(1).max(1000),
              })
              .strict(),
          )
          .max(500),
      })
      .strict(),
  })
  .strict();
export type SourcePreflightInput = z.infer<typeof sourcePreflightSchema>;
export type SourceIssue = {
  code: string;
  column: number | null;
  message: string;
};

/** A read-only layout check, never authorization to release an order for picking. */
export function inspectSourceHeaders(input: unknown) {
  const { snapshot, mapping } = sourcePreflightSchema.parse(input);
  const headers = Array.from({ length: snapshot.columnCount }, (_, i) =>
    (snapshot.headers[i] ?? "").trim(),
  );
  const issues: SourceIssue[] = [];
  const issue = (code: string, message: string, index?: number) =>
    issues.push({
      code,
      message,
      column: index === undefined ? null : index + 1,
    });
  if (snapshot.sheetTitle !== mapping.sheetTitle)
    issue(
      "wrongSheet",
      "Select and review the exact pickup tab; do not select the latest tab automatically.",
    );
  if (snapshot.columnCount !== mapping.columnCount)
    issue(
      "gridWidthChanged",
      "The source grid width differs from the reviewed layout.",
    );
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (!header) return;
    if (seen.has(header))
      issue(
        "duplicateHeader",
        "A header is repeated after trimming whitespace.",
        index,
      );
    seen.add(header);
    if (!mapping.columns.some((c) => c.index === index))
      issue(
        "unmappedColumn",
        "A named source column has no reviewed disposition.",
        index,
      );
  });
  const indexes = new Set<number>();
  mapping.columns.forEach((column) => {
    if (indexes.has(column.index))
      issue(
        "duplicateMapping",
        "A column has more than one mapping.",
        column.index,
      );
    indexes.add(column.index);
    if (
      column.index >= snapshot.columnCount ||
      column.index >= mapping.columnCount
    )
      issue(
        "columnOutOfBounds",
        "A mapped column is outside the declared grid.",
        column.index,
      );
    if (headers[column.index] !== column.header)
      issue(
        "headerMismatch",
        "The mapped header is missing or changed at this position.",
        column.index,
      );
  });
  for (const required of [
    "responseTimestamp",
    "registrationId",
    "householdLabel",
    "request",
  ] as const) {
    const columns = mapping.columns.filter((c) => c.role === required);
    if (!columns.length)
      issue("missingRole", `No reviewed ${required} column is mapped.`);
    if (required !== "request" && columns.length > 1)
      issue("ambiguousIdentity", `More than one ${required} column is mapped.`);
  }
  return {
    mappingVersion: mapping.version,
    sheetTitle: snapshot.sheetTitle,
    layoutMatches: issues.length === 0,
    importReady: false as const,
    // Includes the tab and full normalized layout, not household values or source IDs.
    headerFingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          sheetTitle: snapshot.sheetTitle,
          headers,
        }),
      )
      .digest("hex"),
    issues,
    remainingChecks: [
      "Verify provenance and the complete bounded source read.",
      "Resolve missing or duplicate response identities; ID# alone is not unique.",
      "Review every request value, dietary instruction and free-text field.",
      "Approve quantities, units, shelves, storage and preparation timing; produce and perishables wait for arrival.",
      "Preview and explicitly apply normalized manifests through the coordinator workflow.",
    ],
  };
}
