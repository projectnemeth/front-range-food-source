import { z } from "zod";
import { WorkflowError } from "./workflow";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const text = z.string().trim().min(1).max(120);
export const allocationInputSchema = z
  .object({
    itemId: id,
    item: text,
    unit: text,
    available: z.number().int().min(0).max(10000),
    households: z
      .array(
        z
          .object({
            key: id,
            label: text,
            size: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    eligibilityConfirmed: z.literal(true),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.households.map((h) => h.key)).size ===
      input.households.length,
    "Household keys must be unique",
  );
export const allocationPreviewSchema = z
  .object({
    action: z.literal("allocationPreview"),
    eventId: id,
    operationId: id,
    input: allocationInputSchema,
  })
  .strict();
export const allocationApproveSchema = z
  .object({
    action: z.literal("allocationApprove"),
    eventId: id,
    draftId: id,
    confirmed: z.literal(true),
    quantities: z
      .array(
        z
          .object({
            key: id,
            quantity: z.number().int().min(0).max(10000),
            reason: z.string().trim().max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const allocationReadSchema = z
  .object({ action: z.literal("allocationRead"), eventId: id, draftId: id })
  .strict();
export type AllocationInput = z.infer<typeof allocationInputSchema>;
export type AllocationQuantity = z.infer<
  typeof allocationApproveSchema
>["quantities"][number];
export type AllocationDraft = {
  id: string;
  eventId: string;
  actor: string;
  eventVersion: number;
  itemVersion: number;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  input: AllocationInput;
  proposed: AllocationQuantity[];
  approved?: AllocationQuantity[];
  approvalFingerprint?: string;
};
export type AllocationSummary = {
  itemId: string;
  item: string;
  unit: string;
  available: number;
  allocated: number;
  version: number;
  draftId: string;
};

// Largest-remainder apportionment using integer arithmetic. No minimum is implied.
export function proposeAllocation(value: unknown): AllocationQuantity[] {
  const input = allocationInputSchema.parse(value);
  const total = input.households.reduce((n, h) => n + h.size, 0);
  const shares = input.households.map((h) => ({
    key: h.key,
    quantity: Math.floor((input.available * h.size) / total),
    remainder: (input.available * h.size) % total,
  }));
  let remaining = input.available - shares.reduce((n, h) => n + h.quantity, 0);
  const ranked = [...shares].sort(
    (a, b) =>
      b.remainder - a.remainder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  for (const h of ranked) {
    if (remaining-- <= 0) break;
    h.quantity++;
  }
  return shares.map((h) => ({ key: h.key, quantity: h.quantity, reason: "" }));
}
export function validateAllocation(
  draft: AllocationDraft,
  quantities: AllocationQuantity[],
) {
  if (
    quantities.length !== draft.proposed.length ||
    new Set(quantities.map((q) => q.key)).size !== quantities.length
  )
    throw new WorkflowError("allocationHouseholdsChanged");
  for (const q of quantities) {
    const proposed = draft.proposed.find((p) => p.key === q.key);
    if (!proposed) throw new WorkflowError("allocationHouseholdsChanged");
    if (q.quantity !== proposed.quantity && !q.reason.trim())
      throw new WorkflowError("allocationReasonRequired");
  }
  const allocated = quantities.reduce((n, q) => n + q.quantity, 0);
  if (allocated > draft.input.available)
    throw new WorkflowError("allocationOverStock");
  return allocated;
}
