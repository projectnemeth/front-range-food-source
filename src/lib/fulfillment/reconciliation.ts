import { z } from "zod";
import {
  createFulfillmentOrder,
  reconciledManifestSchema,
  type Line,
  type PackingAllocation,
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
export const additionSchema = z
  .object({
    lineId: z.string().trim().min(1).max(160),
    category: z.enum([
      "shelfStable",
      "produce",
      "refrigerated",
      "frozen",
      "otherPerishable",
    ]),
    reason,
    stockConfirmed: z.literal(true),
    available: z.number().int().min(0).max(10000).optional(),
  })
  .strict();
export type ReconciliationAddition = z.infer<typeof additionSchema> & {
  budget: null | {
    itemId: string;
    planId: string;
    householdKey: string;
    itemVersion: number;
    previousAvailable: number;
    previousAllocated: number;
    available: number;
    quantity: number;
  };
};
export function selectionTiming(
  category: z.infer<typeof additionSchema>["category"],
) {
  return {
    stage:
      category === "shelfStable"
        ? ("advanceDry" as const)
        : ("afterArrival" as const),
    storage:
      category === "refrigerated"
        ? ("chilled" as const)
        : category === "frozen"
          ? ("frozen" as const)
          : ("ambient" as const),
  };
}
export const itemIdentity = (item: string) =>
  item.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

export const removalSchema = z
  .object({
    lineId: z.string().trim().min(1).max(160),
    reason,
    returnedQuantity: z.number().int().min(0).max(10000),
    discardedQuantity: z.number().int().min(0).max(10000),
    goodsNote: reason,
    budgetDiscardedQuantity: z.number().int().min(0).max(10000).optional(),
    stockBeforeDisposal: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .refine(
    (r) => r.returnedQuantity + r.discardedQuantity <= 10000,
    "Accounted goods exceed limit",
  );
export type ReconciliationRemoval = z.infer<typeof removalSchema> & {
  line: Line;
  allocation: PackingAllocation | null;
  recordedQuantity: number;
  replacement: string | null;
  budgetDiscardedQuantity: number;
};
export const reconciliationPreviewSchema = z
  .object({
    action: z.literal("reconciliationPreview"),
    eventId: id,
    reviewId: id,
    operationId: id,
    manifest: reconciledManifestSchema,
    removals: z.array(removalSchema).max(200).default([]),
    additions: z.array(additionSchema).max(100).default([]),
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
  additions?: ReconciliationAddition[];
  removals?: ReconciliationRemoval[];
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
  const next = createFulfillmentOrder(manifest, true);
  next.version = current.version + 1;
  next.arrival = current.arrival;
  const householdKey =
    current.allocationHouseholdKey ??
    Object.values(current.allocations ?? {})[0]?.householdKey;
  if (householdKey) next.allocationHouseholdKey = householdKey;
  if (!manifest.lines.length) {
    next.control = "held";
    next.reason =
      "All item selections removed. Coordinator review is required before adding items.";
  }
  if (allocations) next.allocations = allocations;
  if (next.arrival && next.portions.afterArrival.state === "waiting")
    next.portions.afterArrival.state = "queued";
  return next;
}
