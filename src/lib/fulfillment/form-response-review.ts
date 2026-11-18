import { z } from "zod";
import { reviewPickupTimestamp } from "./pickup-window";
import headers from "./form-response-headers.json";
import {
  inspectSourceHeaders,
  sourcePreflightSchema,
  type SourcePreflightInput,
} from "./source-preflight";

// Header-only evidence from November 18, 2026. No client values or source IDs.
export const formResponseMapping: SourcePreflightInput["mapping"] = {
  version: "form-responses-layout-2026-11-18",
  sheetTitle: "2025",
  columnCount: 39,
  columns: headers.map((header, index) => {
    const role =
      index === 0
        ? "responseTimestamp"
        : index === 1
          ? "registrationId"
          : index === 2
            ? "householdLabel"
            : [14, 15, 16, 17].includes(index)
              ? "dietary"
              : [19, 20, 21, 23, 24, 25, 26, 27, 32].includes(index)
                ? "request"
                : [9, 10, 11, 12, 13, 18, 22, 28, 29, 30, 31].includes(index)
                  ? "notes"
                  : "ignore";
    return {
      index,
      header: header.trim(),
      role,
      reason:
        role === "ignore"
          ? "Exclude address, contact and demographic identifiers from fulfillment review"
          : "Preserve original values for coordinator review; no allocation or event inference",
      ...([9, 30].includes(index) ? { allowDuplicateHeader: true } : {}),
    };
  }),
};
const inputSchema = z
  .object({
    snapshot: sourcePreflightSchema.shape.snapshot,
    // A bounded slice is not a complete event or a deletion signal.
    rows: z
      .array(
        z
          .object({
            rowNumber: z.number().int().min(2),
            cells: z.array(z.string().max(10000).nullable()).max(39),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.rows.map((r) => r.rowNumber)).size === value.rows.length,
    "Row locators must be distinct in this slice",
  );

/** Extract original request cells for review; never produce pickable manifests. */
export function reviewFormResponses(input: unknown) {
  const parsed = inputSchema.parse(input);
  const layout = inspectSourceHeaders({
    snapshot: parsed.snapshot,
    mapping: formResponseMapping,
  });
  if (!layout.layoutMatches)
    return { layout, importReady: false as const, records: [] };
  const populated = parsed.rows.filter((r) => r.cells.some((v) => v?.trim()));
  const records = populated.map((row) => {
    const cell = (index: number) => row.cells[index] ?? "";
    const issues: string[] = [
      "pickupEventReviewRequired",
      "allocationReviewRequired",
      "identityReviewRequired",
    ];
    if (!cell(0).trim()) issues.push("missingTimestamp");
    if (!cell(1).trim()) issues.push("missingRegistrationId");
    if (!cell(2).trim() && !cell(31).trim())
      issues.push("missingHouseholdName");
    if (cell(2).trim() && cell(31).trim() && cell(2).trim() !== cell(31).trim())
      issues.push("conflictingHouseholdNames");
    if (cell(9).trim() && cell(30).trim() && cell(9).trim() !== cell(30).trim())
      issues.push("conflictingHouseholdSizes");
    if (row.cells.some((v, i) => i >= headers.length && v?.trim()))
      issues.push("unlabeledColumnData");
    if (
      cell(1).trim() &&
      populated.filter((r) => r.cells[1]?.trim() === cell(1).trim()).length > 1
    )
      issues.push("repeatedRegistrationInSlice");
    const fields = formResponseMapping.columns
      .filter(
        (c) =>
          ![
            "ignore",
            "responseTimestamp",
            "registrationId",
            "householdLabel",
          ].includes(c.role),
      )
      .map((c) => ({
        column: c.index + 1,
        header: c.header,
        role: c.role,
        originalValue: cell(c.index),
        // Category timing only. Dry candidates still require item-specific review.
        preparation:
          c.index === 27 || c.index === 32
            ? "afterArrival"
            : [19, 20, 21, 23, 24, 25, 26].includes(c.index)
              ? "advanceDryCandidate"
              : "review",
      }));
    if (!fields.some((f) => f.role === "request" && f.originalValue.trim()))
      issues.push("noItemRequests");
    const pickupWindow = reviewPickupTimestamp(cell(0));
    if (pickupWindow.status !== "candidate") issues.push(pickupWindow.status);
    else if (pickupWindow.boundaryClockReview)
      issues.push("boundaryClockReviewRequired");
    return {
      pickupWindow,
      rowNumber: row.rowNumber, // Locator only; never a durable registration key.
      timestamp: cell(0),
      registrationId: cell(1),
      householdNames: { original: cell(2), later: cell(31) },
      householdSizes: { original: cell(9), later: cell(30) },
      fields,
      unmappedFields: row.cells.flatMap((value, index) =>
        index >= headers.length && value?.trim()
          ? [{ column: index + 1, originalValue: value }]
          : [],
      ),
      issues,
      importReady: false as const,
    };
  });
  return { layout, importReady: false as const, records };
}
