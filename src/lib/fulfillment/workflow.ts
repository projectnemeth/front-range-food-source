import {
  commandSchema,
  type Actor,
  type FulfillmentOrder,
  type Stage,
} from "./model";

export class WorkflowError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
function requireState(condition: unknown, code: string): asserts condition {
  if (!condition) throw new WorkflowError(code);
}
const stages: Stage[] = ["advanceDry", "afterArrival"];

function releasePerishables(order: FulfillmentOrder) {
  if (
    order.control === "active" &&
    order.arrival &&
    order.portions.afterArrival.state === "waiting"
  ) {
    order.portions.afterArrival.state = "queued";
  }
}

export function preparationComplete(order: FulfillmentOrder) {
  return stages.every((stage) =>
    ["packed", "notRequired"].includes(order.portions[stage].state),
  );
}
export function readyForHandoff(order: FulfillmentOrder, runner?: string) {
  if (
    order.control !== "active" ||
    !order.arrival ||
    order.deliveredAt ||
    !preparationComplete(order) ||
    !order.packages.length
  )
    return false;
  const owner = runner ?? order.packages[0].custody;
  return (
    !!owner &&
    order.packages.every((pkg) => pkg.custody === owner && !pkg.handedOver)
  );
}

/** Pure domain operation, not an API or a persistence/authentication boundary.
 * The future server must derive Actor from credentials and commit version checks
 * and operation receipts atomically. No production module imports this yet.
 */
export function applyCommand(
  current: FulfillmentOrder,
  expectedVersion: number,
  actor: Actor,
  input: unknown,
  now: string,
): FulfillmentOrder {
  const command = commandSchema.parse(input);
  requireState(
    actor.id.trim() && actor.eventId === current.manifest.eventId,
    "forbidden",
  );
  requireState(Number.isFinite(Date.parse(now)), "invalidTime");
  requireState(current.version === expectedVersion, "staleVersion");
  requireState(!current.deliveredAt, "alreadyDelivered");
  const order = structuredClone(current);
  const coordinator = actor.role === "coordinator";

  if (command.type === "control") {
    requireState(coordinator, "forbidden");
    order.control = command.state;
    order.reason = command.reason;
    releasePerishables(order);
  } else if (command.type === "arrival") {
    requireState(actor.role === "arrivalBridge", "forbidden");
    requireState(
      !["cancelled", "departed"].includes(order.control),
      "orderInactive",
    );
    if (order.arrival) {
      requireState(
        order.arrival.id === command.arrival.id,
        "arrivalIdentityConflict",
      );
      if (command.arrival.revision < order.arrival.revision)
        return structuredClone(current);
      if (command.arrival.revision === order.arrival.revision) {
        const same = Object.entries(command.arrival).every(
          ([key, value]) =>
            order.arrival![key as keyof typeof order.arrival] === value,
        );
        requireState(same, "arrivalRevisionConflict");
        return structuredClone(current);
      }
      requireState(
        order.arrival.checkedInAt === command.arrival.checkedInAt,
        "arrivalTimeConflict",
      );
    }
    order.arrival = command.arrival;
    releasePerishables(order);
  } else {
    requireState(order.control === "active", "orderInactive");
    if (["claim", "resolve", "pack"].includes(command.type)) {
      requireState(coordinator || actor.role === "packer", "forbidden");
    }
    switch (command.type) {
      case "claim": {
        const portion = order.portions[command.stage];
        requireState(
          command.stage === "advanceDry" || order.arrival,
          "arrivalRequired",
        );
        requireState(portion.state === "queued", "portionUnavailable");
        portion.owner = actor.id;
        portion.state = "picking";
        break;
      }
      case "resolve": {
        const line = order.manifest.lines.find(
          (line) => line.id === command.lineId,
        );
        requireState(line, "unknownLine");
        const portion = order.portions[line.stage];
        requireState(
          portion.state === "picking" && portion.owner === actor.id,
          "notAssigned",
        );
        requireState(
          line.stage === "advanceDry" || order.arrival,
          "arrivalRequired",
        );
        requireState(command.quantity <= line.quantity, "excessQuantity");
        requireState(
          !command.replacement || command.quantity > 0,
          "emptyReplacement",
        );
        const exception =
          command.quantity !== line.quantity || !!command.replacement;
        requireState(!exception || command.reason, "reasonRequired");
        order.resolutions[line.id] = {
          quantity: command.quantity,
          replacement: command.replacement,
          reason: command.reason,
          approvedBy: null,
        };
        break;
      }
      case "approve": {
        requireState(coordinator, "forbidden");
        const resolution = order.resolutions[command.lineId];
        requireState(resolution, "unresolvedLine");
        resolution.approvedBy = actor.id;
        resolution.reason = command.reason;
        break;
      }
      case "pack": {
        const portion = order.portions[command.stage];
        requireState(
          portion.state === "picking" && portion.owner === actor.id,
          "notAssigned",
        );
        requireState(
          command.stage === "advanceDry" || order.arrival,
          "arrivalRequired",
        );
        const lines = order.manifest.lines.filter(
          (line) => line.stage === command.stage,
        );
        for (const line of lines) {
          const resolution = order.resolutions[line.id];
          requireState(resolution, "unresolvedLine");
          requireState(
            (resolution.quantity === line.quantity &&
              !resolution.replacement) ||
              resolution.approvedBy,
            "exceptionNeedsApproval",
          );
        }
        const supplied = lines.some(
          (line) => order.resolutions[line.id].quantity > 0,
        );
        requireState(
          supplied === command.packages.length > 0,
          "packageCountMismatch",
        );
        const ids = [
          ...order.packages.map((pkg) => pkg.id),
          ...command.packages.map((pkg) => pkg.id),
        ];
        requireState(new Set(ids).size === ids.length, "duplicatePackage");
        order.packages.push(
          ...command.packages.map((pkg) => ({
            ...pkg,
            stage: command.stage,
            custody: null,
            handedOver: false,
          })),
        );
        portion.state = "packed";
        break;
      }
      case "gather": {
        requireState(coordinator || actor.role === "runner", "forbidden");
        requireState(order.arrival, "arrivalRequired");
        const pkg = order.packages.find((pkg) => pkg.id === command.packageId);
        requireState(pkg, "unknownPackage");
        requireState(
          !pkg.custody || pkg.custody === actor.id,
          "packageAlreadyClaimed",
        );
        pkg.custody = actor.id;
        break;
      }
      case "handoff": {
        requireState(coordinator || actor.role === "runner", "forbidden");
        requireState(readyForHandoff(order, actor.id), "notReadyForHandoff");
        for (const pkg of order.packages) pkg.handedOver = true;
        order.deliveredAt = now;
        break;
      }
    }
  }
  order.version += 1;
  return order;
}
