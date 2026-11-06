import { z } from "zod";

const id = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
    "Reserved identifier",
  );
const text = z.string().trim().min(1).max(2000);
export const stageSchema = z.enum(["advanceDry", "afterArrival"]);
export type Stage = z.infer<typeof stageSchema>;
export const lineSchema = z
  .object({
    id,
    originalRequest: text,
    item: text,
    stage: stageSchema,
    storage: z.enum(["ambient", "chilled", "frozen"]),
    quantity: z.number().int().positive().max(10000),
    unit: id,
    shelf: id,
  })
  .strict()
  .refine(
    (line) => line.stage !== "advanceDry" || line.storage === "ambient",
    "Cold items cannot be prepared before arrival",
  );
export const manifestSchema = z
  .object({
    id,
    eventId: id,
    source: z
      .object({
        kind: z.enum(["googleSheet", "nativeOrder", "walkUp"]),
        key: id,
        revision: id,
      })
      .strict(),
    mappingVersion: id,
    householdLabel: text,
    notes: z.string().max(4000),
    dietary: z.string().max(2000).nullable(),
    lines: z.array(lineSchema).min(1).max(200),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.lines.map((line) => line.id)).size === input.lines.length,
    "Line IDs must be unique",
  );
export type Manifest = z.infer<typeof manifestSchema>;
export type Line = Manifest["lines"][number];
export type Resolution = {
  quantity: number;
  replacement: string | null;
  reason: string | null;
  approvedBy: string | null;
};
export type Portion = {
  state: "notRequired" | "waiting" | "queued" | "picking" | "packed";
  owner: string | null;
};
export type Arrival = {
  id: string;
  revision: number;
  checkedInAt: string;
  line: "blue" | "orange";
  number: string;
  vehicle: string;
};
export type Package = {
  id: string;
  stage: Stage;
  location: string;
  custody: string | null;
  handedOver: boolean;
};
export type FulfillmentOrder = {
  manifest: Manifest;
  version: number;
  control: "active" | "held" | "cancelled" | "departed";
  reason: string | null;
  arrival: Arrival | null;
  portions: Record<Stage, Portion>;
  resolutions: Record<string, Resolution>;
  packages: Package[];
  deliveredAt: string | null;
};

export function createFulfillmentOrder(input: unknown): FulfillmentOrder {
  const manifest = manifestSchema.parse(input);
  const portion = (stage: Stage): Portion => ({
    state: manifest.lines.some((line) => line.stage === stage)
      ? stage === "advanceDry"
        ? "queued"
        : "waiting"
      : "notRequired",
    owner: null,
  });
  return {
    manifest,
    version: 0,
    control: "active",
    reason: null,
    arrival: null,
    portions: {
      advanceDry: portion("advanceDry"),
      afterArrival: portion("afterArrival"),
    },
    resolutions: {},
    packages: [],
    deliveredAt: null,
  };
}

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("claim"), stage: stageSchema }).strict(),
  z
    .object({
      type: z.literal("resolve"),
      lineId: id,
      quantity: z.number().int().min(0).max(10000),
      replacement: text.nullable(),
      reason: text.nullable(),
    })
    .strict(),
  z.object({ type: z.literal("approve"), lineId: id, reason: text }).strict(),
  z
    .object({
      type: z.literal("pack"),
      stage: stageSchema,
      packages: z.array(z.object({ id, location: id }).strict()).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("arrival"),
      arrival: z
        .object({
          id,
          revision: z.number().int().positive(),
          checkedInAt: z.iso.datetime(),
          line: z.enum(["blue", "orange"]),
          number: z.string().regex(/^\d{3}$/),
          vehicle: z.string().max(30),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("gather"), packageId: id }).strict(),
  z.object({ type: z.literal("handoff") }).strict(),
  z
    .object({
      type: z.literal("control"),
      state: z.enum(["active", "held", "cancelled", "departed"]),
      reason: text,
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type Actor = {
  id: string;
  eventId: string;
  role: "coordinator" | "packer" | "runner" | "arrivalBridge";
};
