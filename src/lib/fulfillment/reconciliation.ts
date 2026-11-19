import { z } from "zod";
import {
  createFulfillmentOrder,
  manifestSchema,
  type FulfillmentOrder,
  type Manifest,
} from "./model";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const reason = z.string().trim().min(1).max(2000);
export const reconciliationReadSchema = z
  .object({ action: z.literal("reconciliationRead"), eventId: id, orderId: id })
  .strict();
export const reconciliationStartSchema = z
  .object({
    action: z.literal("reconciliationStart"),
    eventId: id,
    orderId: id,
    operationId: id,
    expectedVersion: z.number().int().nonnegative(),
    reason,
  })
  .strict();
export const reconciliationPreviewSchema = z
  .object({
    action: z.literal("reconciliationPreview"),
    eventId: id,
    reviewId: id,
    operationId: id,
    manifest: manifestSchema,
    adjustments: z
      .array(
        z
          .object({
            lineId: z.string().min(1).max(160),
            quantity: z.number().int().min(0).max(10000),
            available: z.number().int().min(0).max(10000),
            reason,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const reconciliationApplySchema = z
  .object({
    action: z.literal("reconciliationApply"),
    eventId: id,
    previewId: id,
    confirmed: z.literal(true),
    goodsAccountedFor: z.literal(true),
    stagingCleared: z.literal(true),
    workNote: reason,
    packages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            disposition: z.enum([
              "retainedForRepack",
              "returnedToStock",
              "discarded",
            ]),
            note: reason,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const reconciliationCancelSchema = z
  .object({
    action: z.literal("reconciliationCancel"),
    eventId: id,
    reviewId: id,
    expectedVersion: z.number().int().nonnegative(),
    goodsUnchanged: z.literal(true),
    reason,
  })
  .strict();
export type ReconciliationCommand =
  | z.infer<typeof reconciliationReadSchema>
  | z.infer<typeof reconciliationStartSchema>
  | z.infer<typeof reconciliationPreviewSchema>
  | z.infer<typeof reconciliationApplySchema>
  | z.infer<typeof reconciliationCancelSchema>;
export type ReconciliationReview = {
  id: string;
  eventId: string;
  orderId: string;
  household: string;
  actor: string;
  reason: string;
  startedAt: string;
  status: "open" | "applied" | "cancelled";
  before: FulfillmentOrder;
  startFingerprint: string;
  finishFingerprint?: string;
  finishedAt?: string;
};
export type ReconciliationPreview = {
  id: string;
  eventId: string;
  reviewId: string;
  actor: string;
  eventVersion: number;
  orderFingerprint: string;
  fingerprint: string;
  expiresAt: string;
  manifest: Manifest;
  adjustments: (z.infer<
    typeof reconciliationPreviewSchema
  >["adjustments"][number] & {
    itemId: string;
    itemVersion: number;
    previousQuantity: number;
    previousAvailable: number;
    previousAllocated: number;
  })[];
  appliedAt: string | null;
  applyFingerprint?: string;
};
export type ReconciliationView = {
  order: FulfillmentOrder;
  review: ReconciliationReview | null;
};
export type ReconciliationSummary = {
  id: string;
  orderId: string;
  household: string;
  reason: string;
};

export function restartedOrder(
  current: FulfillmentOrder,
  manifest: Manifest,
  allocations: FulfillmentOrder["allocations"],
) {
  const next = createFulfillmentOrder(manifest);
  next.version = current.version + 1;
  next.arrival = current.arrival;
  if (allocations) next.allocations = allocations;
  if (next.arrival && next.portions.afterArrival.state === "waiting")
    next.portions.afterArrival.state = "queued";
  return next;
}
