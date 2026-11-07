import type {
  FulfillmentOrder,
  Line,
  Package,
  Portion,
  Resolution,
} from "./model";

export type DrySummary = {
  id: string;
  household: string;
  version: number;
  control: FulfillmentOrder["control"];
  dry: Portion;
  packageCount: number;
  perishableCount: number;
};
export type DryDetail = DrySummary & {
  notes: string;
  dietary: string | null;
  lines: Line[];
  resolutions: Record<string, Resolution>;
  packages: Package[];
};
export type DryLocation = {
  code: string;
  capacity: number;
  count: number;
  orderId: string | null;
};
export type DryResponse = {
  actorId: string;
  role: "coordinator" | "packer";
  orders: DrySummary[];
  nextCursor: string | null;
  detail: DryDetail | null;
  locations: DryLocation[];
};
export function drySummary(order: FulfillmentOrder): DrySummary {
  return {
    id: order.manifest.id,
    household: order.manifest.householdLabel,
    version: order.version,
    control: order.control,
    dry: order.portions.advanceDry,
    packageCount: order.packages.filter((pkg) => pkg.stage === "advanceDry")
      .length,
    perishableCount: order.manifest.lines.filter(
      (line) => line.stage === "afterArrival",
    ).length,
  };
}
export function dryDetail(order: FulfillmentOrder): DryDetail {
  const lines = order.manifest.lines
    .filter((line) => line.stage === "advanceDry")
    .sort(
      (a, b) =>
        a.shelf.localeCompare(b.shelf, undefined, { numeric: true }) ||
        a.item.localeCompare(b.item),
    );
  return {
    ...drySummary(order),
    notes: order.manifest.notes,
    dietary: order.manifest.dietary,
    lines,
    resolutions: Object.fromEntries(
      lines
        .filter((line) => Object.hasOwn(order.resolutions, line.id))
        .map((line) => [line.id, order.resolutions[line.id]]),
    ),
    packages: order.packages.filter((pkg) => pkg.stage === "advanceDry"),
  };
}
