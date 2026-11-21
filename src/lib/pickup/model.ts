import { createHash } from "node:crypto";
import { z } from "zod";
export const BUILD = "hosted-2026-11-21.3";
export const key = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export const arrivalSchema = z
  .object({
    number: z.string().regex(/^\d{3}$/),
    line: z.enum(["blue", "orange"]),
    vehicle: z.string().max(30).default(""),
  })
  .strict();
export type Arrival = z.infer<typeof arrivalSchema>;
export const printerSchema = z.object({
  id: z.number().int().positive(),
  dpi: z.union([z.literal(203), z.literal(300)]),
  widthIn: z.number().min(1.5).max(4.1),
  heightIn: z.number().min(1).max(4),
});
export type Printer = z.infer<typeof printerSchema>;
export interface Candidate {
  key: string;
  name: string;
  phone: string;
  phoneSearch: string;
  householdSize: number | null;
  errors: string[];
  submittedAt: string;
  sourceRow: number;
}
export interface Registration {
  id: string;
  eventId: string;
  revision: number;
  name: string;
  phone: string;
  phoneSearch: string;
  householdSize: number | null;
  errors: string[];
  sourceKind: "sheets" | "walkin";
  sourceSheetId?: number;
  externalId?: string;
  sourceRow?: number;
  sourceSubmittedAt?: string;
  fingerprint?: string;
  groupKey?: string;
  duplicateCandidates?: Candidate[];
  duplicateReview?: {
    groupKey: string;
    candidateKey: string;
    reason: string;
    actor: string;
    reviewedAt: string;
  } | null;
  reviewRequired?: boolean;
  inactive?: boolean;
  sourceMissing?: boolean;
  checkedInAt?: string;
  checkedInBy?: string;
  arrival?: Arrival | null;
  arrivalJobId?: string;
  walkIn?: boolean;
  walkInToken?: string;
  pickupType?: string;
  prepackedReason?: "noShow" | "walkUp" | null;
  previousNoShow?: boolean;
}
export interface PickupEvent {
  id: string;
  label: string;
  sourceSheetId: number;
  enabled: boolean;
}
export interface Job {
  id: string;
  registrationId: string;
  eventId: string;
  revision: number;
  action: string;
  token: string;
  status: string;
  copies: number;
  createdAt: string;
  actor: string;
  station: string;
  printerId: number;
  zpl: string;
  arrival: Arrival | null;
  prepackedReason: string | null;
  providerId?: string | null;
  providerState?: string | null;
  providerCheckedAt?: string | null;
  failureReason?: string | null;
  confirmedAt?: string | null;
  reason: string;
}
export class PickupError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function normalize(input: {
  name: unknown;
  phone: unknown;
  householdSize: unknown;
}) {
  const name = clean(input.name),
    phone = clean(input.phone),
    size = clean(input.householdSize),
    householdSize = /^\d+$/.test(size) ? Number(size) : null,
    errors: string[] = [];
  if (!name || name.length > 100)
    errors.push("Name must contain 1–100 characters.");
  if (!phone || phone.length > 40)
    errors.push(
      "Phone is missing or too long; confirm No phone if appropriate.",
    );
  if (!householdSize || householdSize > 99)
    errors.push("Review household size (expected 1–99).");
  return {
    name,
    phone,
    householdSize,
    phoneSearch: phone.replace(/\D/g, ""),
    errors,
  };
}
export function parseSheet(headers: unknown[], rows: unknown[][]) {
  const h = headers.map(clean);
  const assumedDateColumn = !h[0] && !h.includes("Date");
  if (assumedDateColumn) h[0] = "Date";
  const columns = [
    "Date",
    "ID#",
    "First & Last Name",
    "Phone Number",
    "Total in Family",
  ].map((name) => {
    const matches = h.flatMap((x, i) => (x === name ? [i] : []));
    if (matches.length !== 1)
      throw new PickupError(409, "Missing or ambiguous source header: " + name);
    return matches[0];
  });
  let last = -1;
  rows.forEach((r, i) => {
    if (clean(r[columns[2]])) last = i;
  });
  const groups = new Map<string, Candidate[]>();
  let sourceRows = 0,
    ignoredAfterList = 0;
  rows.forEach((row, i) => {
    if (!columns.some((col) => clean(row[col]))) return;
    if (i > last) {
      ignoredAfterList++;
      return;
    }
    sourceRows++;
    const externalId = clean(row[columns[1]]);
    if (!externalId || externalId.length > 100)
      throw new PickupError(
        409,
        `Missing ID# at source row ${i + 2}; no records imported.`,
      );
    const data = normalize({
        name: row[columns[2]],
        phone: row[columns[3]],
        householdSize: row[columns[4]],
      }),
      submittedAt = clean(row[columns[0]]);
    if (!submittedAt) data.errors.push("Submission date is missing.");
    const candidate = {
      ...data,
      submittedAt,
      sourceRow: i + 2,
      key: key(
        JSON.stringify([
          submittedAt,
          data.name,
          data.phone,
          data.householdSize,
        ]),
      ),
    };
    groups.set(externalId, [...(groups.get(externalId) || []), candidate]);
  });
  return {
    groups,
    sourceRows,
    ignoredAfterList,
    assumedDateColumn,
    lastListRow: last < 0 ? null : last + 2,
  };
}
export function mergeSource(
  sourceId: string,
  event: PickupEvent,
  externalId: string,
  candidates: Candidate[],
  old?: Registration,
): Registration {
  const sorted = candidates.slice().sort((a, b) => a.key.localeCompare(b.key)),
    groupKey = key(JSON.stringify(sorted.map((x) => x.key))),
    review =
      old?.duplicateReview?.groupKey === groupKey ? old.duplicateReview : null;
  const chosen =
      sorted.find((x) => x.key === review?.candidateKey) || sorted[0],
    reviewRequired = sorted.length > 1 && !review;
  const fingerprint = key(
    JSON.stringify([
      chosen.key,
      groupKey,
      review?.candidateKey || null,
      event.id,
    ]),
  );
  return {
    ...old,
    id: `sheet:${sourceId}:${event.sourceSheetId}:${encodeURIComponent(externalId)}`,
    eventId: event.id,
    sourceKind: "sheets",
    sourceSheetId: event.sourceSheetId,
    externalId,
    name: chosen.name,
    phone: chosen.phone,
    phoneSearch: chosen.phoneSearch,
    householdSize: chosen.householdSize,
    sourceRow: chosen.sourceRow,
    sourceSubmittedAt: chosen.submittedAt,
    errors: [
      ...chosen.errors,
      ...(reviewRequired ? ["Repeated ID#: coordinator review required."] : []),
    ],
    groupKey,
    duplicateCandidates: sorted.length > 1 ? sorted : [],
    duplicateReview: review,
    reviewRequired,
    fingerprint,
    revision: old
      ? old.revision + (old.fingerprint === fingerprint ? 0 : 1)
      : 1,
    inactive: false,
    sourceMissing: false,
  };
}
export const publicJob = (job: Job) => {
  const { zpl: _zpl, ...safe } = job;
  void _zpl;
  return {
    ...safe,
    status:
      job.status === "Sending" &&
      Date.now() - Date.parse(job.createdAt) > 120000
        ? "Outcome unknown"
        : job.status,
  };
};
