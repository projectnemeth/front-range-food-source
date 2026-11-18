import { z } from "zod";
import {
  createFulfillmentOrder,
  type FulfillmentOrder,
  type Line,
} from "./model";
import { fulfillmentKey } from "./store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
export const packingPreviewSchema = z
  .object({
    action: z.literal("packingAllocationPreview"),
    eventId: id,
    operationId: id,
    planId: id,
    links: z
      .array(
        z
          .object({
            householdKey: id,
            orderId: id,
            lineId: z.string().min(1).max(160),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const packingApplySchema = z
  .object({
    action: z.literal("packingAllocationApply"),
    eventId: id,
    draftId: id,
    confirmed: z.literal(true),
  })
  .strict();
export type PackingCandidate = {
  id: string;
  household: string;
  version: number;
  unstarted: boolean;
  lines: Line[];
};
export type PackingAllocationDraft = {
  id: string;
  eventId: string;
  actor: string;
  eventVersion: number;
  planId: string;
  itemId: string;
  planVersion: number;
  fingerprint: string;
  expiresAt: string;
  appliedAt: string | null;
  rows: {
    householdKey: string;
    household: string;
    orderId: string;
    line: Line;
    before: number;
    quantity: number;
    reason: string;
    orderFingerprint: string;
  }[];
};
export function allocationWorkUnstarted(order: FulfillmentOrder) {
  const initial = {
    ...createFulfillmentOrder(order.manifest),
    version: order.version,
    ...(order.allocations ? { allocations: order.allocations } : {}),
  };
  return fulfillmentKey(order) === fulfillmentKey(initial);
}
