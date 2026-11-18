import { packingPreviewSchema, packingApplySchema } from "./packing-allocation";
import { z } from "zod";
import {
  allocationPreviewSchema,
  allocationApproveSchema,
  allocationReadSchema,
  type AllocationSummary,
} from "./allocation";
import { validDate } from "../dates";
import { manifestSchema, type Manifest } from "./model";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const text = z.string().trim().min(1).max(120);
export const coordinatorCommandSchema = z.discriminatedUnion("action", [
  packingPreviewSchema,
  packingApplySchema,
  allocationPreviewSchema,
  allocationApproveSchema,
  allocationReadSchema,
  z
    .object({
      action: z.literal("createEvent"),
      eventId: id,
      operationId: id,
      label: text,
      pickupDate: z.string().refine(validDate),
      sourceScope: text.refine(
        (value) => !value.endsWith("/"),
        "Source scope must not end in a slash",
      ),
      mappingVersion: text,
    })
    .strict(),
  z
    .object({
      action: z.literal("setEnabled"),
      eventId: id,
      operationId: id,
      expectedVersion: z.number().int().nonnegative(),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("location"),
      eventId: id,
      operationId: id,
      expectedVersion: z.number().int().nonnegative(),
      code: text,
      capacity: z.number().int().positive().max(100),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("staff"),
      eventId: id,
      operationId: id,
      expectedVersion: z.number().int().nonnegative(),
      uid: id,
      role: z.enum(["packer", "runner"]),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("preview"),
      eventId: id,
      operationId: id,
      manifests: z.array(manifestSchema).min(1).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("apply"),
      eventId: id,
      draftId: id,
      confirmed: z.literal(true),
    })
    .strict(),
]);
export type CoordinatorCommand = z.infer<typeof coordinatorCommandSchema>;
export const coordinatorReadSchema = z.object({ eventId: id }).strict();
export type EventConfig = {
  id: string;
  label: string;
  pickupDate: string;
  enabled: boolean;
  status: "OPEN" | "CLOSED";
  version: number;
  sourceScope: string;
  mappingVersion: string;
};
export type ImportRow = {
  manifest: Manifest;
  status: "new" | "unchanged" | "update" | "blocked";
  reason: string;
  previousManifest?: Manifest;
  previousFingerprint?: string;
};
export type ImportDraft = {
  id: string;
  eventId: string;
  actor: string;
  eventVersion: number;
  fingerprint: string;
  expiresAt: string;
  appliedAt: string | null;
  rows: ImportRow[];
};
export type CoordinatorView = {
  allocations: AllocationSummary[];
  event: EventConfig;
  staff: { uid: string; role: string; active: boolean }[];
  locations: {
    code: string;
    capacity: number;
    count: number;
    active: boolean;
  }[];
};
