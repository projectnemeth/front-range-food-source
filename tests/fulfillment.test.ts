import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFulfillmentOrder,
  type Command,
  type FulfillmentOrder,
  type Stage,
} from "../src/lib/fulfillment/model";
import {
  applyCommand,
  readyForHandoff,
  WorkflowError,
} from "../src/lib/fulfillment/workflow";
import { manifest, actors, arrival } from "./fixtures/fulfillment";

const now = "2026-11-07T16:10:00Z";
const make = () => createFulfillmentOrder(manifest);
function run(order: FulfillmentOrder, command: Command, actor = actors.packer) {
  return applyCommand(order, order.version, actor, command, now);
}
function fails(code: string, action: () => unknown) {
  assert.throws(
    action,
    (error: unknown) => error instanceof WorkflowError && error.code === code,
  );
}
function pack(order: FulfillmentOrder, stage: Stage): FulfillmentOrder {
  order = run(order, { type: "claim", stage });
  for (const line of order.manifest.lines.filter(
    (line) => line.stage === stage,
  )) {
    order = run(order, {
      type: "resolve",
      lineId: line.id,
      quantity: line.quantity,
      replacement: null,
      reason: null,
    });
  }
  return run(order, {
    type: "pack",
    stage,
    packages: [
      {
        id: stage + "-1",
        location: stage === "advanceDry" ? "Table B04" : "Handoff 01",
      },
    ],
  });
}
const arrive = (order: FulfillmentOrder) =>
  run(order, { type: "arrival", arrival }, actors.bridge);

test("approval cannot resolve inherited object keys that are not picked lines", () => {
  const order = make();
  fails("unresolvedLine", () =>
    run(
      order,
      { type: "approve", lineId: "toString", reason: "Invalid line" },
      actors.coordinator,
    ),
  );
  assert.deepEqual(order.resolutions, {});
});

test("complete two-stage flow retains original requests and gathers dry while perishables wait", () => {
  const initial = make();
  let order = pack(initial, "advanceDry");
  assert.equal(initial.version, 0);
  assert.equal(initial.packages.length, 0);
  assert.equal(order.portions.afterArrival.state, "waiting");
  assert.equal(readyForHandoff(order), false);
  fails("arrivalRequired", () =>
    run(order, { type: "gather", packageId: "advanceDry-1" }, actors.runner),
  );
  order = arrive(order);
  assert.equal(order.arrival!.number, "007");
  order = run(
    order,
    { type: "gather", packageId: "advanceDry-1" },
    actors.runner,
  );
  fails("notReadyForHandoff", () =>
    run(order, { type: "handoff" }, actors.runner),
  );
  order = pack(order, "afterArrival");
  assert.equal(readyForHandoff(order), false);
  order = run(
    order,
    { type: "gather", packageId: "afterArrival-1" },
    actors.runner,
  );
  assert.equal(readyForHandoff(order, actors.runner.id), true);
  order = run(order, { type: "handoff" }, actors.runner);
  assert.equal(order.deliveredAt, now);
  assert.ok(order.packages.every((pkg) => pkg.handedOver));
  assert.deepEqual(order.manifest, manifest);
  fails("alreadyDelivered", () =>
    run(order, { type: "handoff" }, actors.runner),
  );
});

test("ambient produce is gated by arrival independently of storage temperature", () => {
  const order = make();
  assert.equal(
    order.manifest.lines.find((line) => line.id === "produce")!.storage,
    "ambient",
  );
  fails("arrivalRequired", () =>
    run(order, { type: "claim", stage: "afterArrival" }),
  );
  fails("notAssigned", () =>
    run(order, {
      type: "resolve",
      lineId: "produce",
      quantity: 1,
      replacement: null,
      reason: null,
    }),
  );
  fails("notAssigned", () =>
    run(order, { type: "pack", stage: "afterArrival", packages: [] }),
  );
});

test("manifest validation rejects missing allocations, unknown fields, duplicate lines and cold advance goods", () => {
  for (const input of [
    { ...manifest, lines: [{ ...manifest.lines[0], quantity: undefined }] },
    { ...manifest, lines: [{ ...manifest.lines[0], storage: "chilled" }] },
    { ...manifest, lines: [manifest.lines[0], manifest.lines[0]] },
    { ...manifest, userId: "invented-account" },
    { ...manifest, lines: [{ ...manifest.lines[0], quantity: -1 }] },
  ])
    assert.throws(() => createFulfillmentOrder(input));
});

test("claims reject a competing actor and stale versions without mutating existing work", () => {
  const initial = make();
  const claimed = run(initial, { type: "claim", stage: "advanceDry" });
  fails("staleVersion", () =>
    applyCommand(
      claimed,
      0,
      actors.otherPacker,
      { type: "claim", stage: "advanceDry" },
      now,
    ),
  );
  fails("portionUnavailable", () =>
    run(claimed, { type: "claim", stage: "advanceDry" }, actors.otherPacker),
  );
  fails("notAssigned", () =>
    run(
      claimed,
      {
        type: "resolve",
        lineId: "rice",
        quantity: 2,
        replacement: null,
        reason: null,
      },
      actors.otherPacker,
    ),
  );
  assert.equal(claimed.portions.advanceDry.owner, actors.packer.id);
});

test("shortages and substitutions require coordinator approval that is invalidated by edits", () => {
  let order = createFulfillmentOrder({
    ...manifest,
    lines: [manifest.lines[0]],
  });
  order = run(order, { type: "claim", stage: "advanceDry" });
  fails("reasonRequired", () =>
    run(order, {
      type: "resolve",
      lineId: "rice",
      quantity: 1,
      replacement: null,
      reason: null,
    }),
  );
  order = run(order, {
    type: "resolve",
    lineId: "rice",
    quantity: 1,
    replacement: "Other rice",
    reason: "Shortage",
  });
  const packageCommand: Command = {
    type: "pack",
    stage: "advanceDry",
    packages: [{ id: "D1", location: "B04" }],
  };
  fails("exceptionNeedsApproval", () => run(order, packageCommand));
  fails("forbidden", () =>
    run(order, { type: "approve", lineId: "rice", reason: "Reviewed" }),
  );
  order = run(
    order,
    { type: "approve", lineId: "rice", reason: "Replacement reviewed" },
    actors.coordinator,
  );
  const approved = order;
  order = run(order, {
    type: "resolve",
    lineId: "rice",
    quantity: 1,
    replacement: null,
    reason: "Changed decision",
  });
  fails("exceptionNeedsApproval", () => run(order, packageCommand));
  assert.equal(
    run(approved, packageCommand).portions.advanceDry.state,
    "packed",
  );
});

test("arrival revisions correct car details without resetting priority or duplicating work", () => {
  let order = arrive(make());
  assert.deepEqual(arrive(order), order);
  const corrected = {
    ...arrival,
    revision: 2,
    line: "orange" as const,
    number: "012",
  };
  order = run(order, { type: "arrival", arrival: corrected }, actors.bridge);
  assert.deepEqual(arrive(order), order);
  assert.equal(order.arrival!.checkedInAt, arrival.checkedInAt);
  fails("arrivalRevisionConflict", () =>
    run(
      order,
      { type: "arrival", arrival: { ...corrected, number: "013" } },
      actors.bridge,
    ),
  );
  fails("arrivalIdentityConflict", () =>
    run(
      order,
      { type: "arrival", arrival: { ...corrected, id: "another" } },
      actors.bridge,
    ),
  );
  fails("arrivalTimeConflict", () =>
    run(
      order,
      {
        type: "arrival",
        arrival: { ...corrected, revision: 3, checkedInAt: now },
      },
      actors.bridge,
    ),
  );
});

test("held arrivals stay blocked until reviewed; cancelled and departed orders reject late arrivals", () => {
  let order = run(
    make(),
    { type: "control", state: "held", reason: "Source duplicate" },
    actors.coordinator,
  );
  order = arrive(order);
  assert.equal(order.portions.afterArrival.state, "waiting");
  fails("orderInactive", () =>
    run(order, { type: "claim", stage: "afterArrival" }),
  );
  order = run(
    order,
    { type: "control", state: "active", reason: "Duplicate resolved" },
    actors.coordinator,
  );
  assert.equal(order.portions.afterArrival.state, "queued");
  for (const state of ["cancelled", "departed"] as const) {
    const stopped = run(
      order,
      { type: "control", state, reason: "Coordinator decision" },
      actors.coordinator,
    );
    fails("orderInactive", () => arrive(stopped));
    fails("orderInactive", () =>
      run(stopped, { type: "claim", stage: "advanceDry" }),
    );
  }
});

test("dry-only and perishable-only orders mark the absent portion not required", () => {
  for (const stage of ["advanceDry", "afterArrival"] as const) {
    let order = createFulfillmentOrder({
      ...manifest,
      lines: manifest.lines.filter((line) => line.stage === stage),
    });
    const other = stage === "advanceDry" ? "afterArrival" : "advanceDry";
    assert.equal(order.portions[other].state, "notRequired");
    order = pack(arrive(order), stage);
    order = run(
      order,
      { type: "gather", packageId: stage + "-1" },
      actors.runner,
    );
    assert.equal(readyForHandoff(order), true);
  }
});

test("zero supplied packages cannot become a complete delivery", () => {
  let order = createFulfillmentOrder({
    ...manifest,
    lines: [manifest.lines[0]],
  });
  order = run(arrive(order), { type: "claim", stage: "advanceDry" });
  order = run(order, {
    type: "resolve",
    lineId: "rice",
    quantity: 0,
    replacement: null,
    reason: "Unavailable",
  });
  order = run(
    order,
    { type: "approve", lineId: "rice", reason: "No replacement" },
    actors.coordinator,
  );
  fails("packageCountMismatch", () =>
    run(order, {
      type: "pack",
      stage: "advanceDry",
      packages: [{ id: "empty", location: "B04" }],
    }),
  );
  order = run(order, { type: "pack", stage: "advanceDry", packages: [] });
  assert.equal(readyForHandoff(order), false);
  fails("notReadyForHandoff", () =>
    run(order, { type: "handoff" }, actors.runner),
  );
});

test("event and role boundaries are enforced by the domain contract", () => {
  const order = make();
  fails("forbidden", () =>
    run(
      order,
      { type: "claim", stage: "advanceDry" },
      { ...actors.packer, eventId: "other-event" },
    ),
  );
  fails("forbidden", () =>
    run(order, { type: "arrival", arrival }, actors.packer),
  );
  fails("forbidden", () =>
    run(order, {
      type: "control",
      state: "cancelled",
      reason: "Not permitted",
    }),
  );
  fails("forbidden", () =>
    run(order, { type: "claim", stage: "advanceDry" }, actors.runner),
  );
});

test("package custody cannot be stolen and partial handoff is not silently supported", () => {
  let order = pack(arrive(make()), "advanceDry");
  order = run(
    order,
    { type: "gather", packageId: "advanceDry-1" },
    actors.runner,
  );
  fails("packageAlreadyClaimed", () =>
    run(
      order,
      { type: "gather", packageId: "advanceDry-1" },
      { ...actors.runner, id: "runner-b" },
    ),
  );
  assert.throws(() =>
    applyCommand(
      order,
      order.version,
      actors.runner,
      { type: "handoff", packageIds: ["advanceDry-1"] },
      now,
    ),
  );
});

test("packing uses allocation targets while retaining original requests and arrival gating", () => {
  let order = make();
  order.allocations = {
    rice: {
      planId: "rice-plan",
      itemId: "rice",
      householdKey: "family",
      quantity: 4,
      approvedBy: "coordinator",
      appliedBy: "coordinator",
      appliedAt: now,
    },
    milk: {
      planId: "milk-plan",
      itemId: "milk",
      householdKey: "family",
      quantity: 2,
      approvedBy: "coordinator",
      appliedBy: "coordinator",
      appliedAt: now,
    },
  };
  fails("arrivalRequired", () =>
    run(order, { type: "claim", stage: "afterArrival" }),
  );
  order = run(order, { type: "claim", stage: "advanceDry" });
  fails("excessQuantity", () =>
    run(order, {
      type: "resolve",
      lineId: "rice",
      quantity: 5,
      replacement: null,
      reason: null,
    }),
  );
  order = run(order, {
    type: "resolve",
    lineId: "rice",
    quantity: 4,
    replacement: null,
    reason: null,
  });
  order = run(order, {
    type: "resolve",
    lineId: "diapers",
    quantity: 1,
    replacement: null,
    reason: null,
  });
  order = run(order, {
    type: "pack",
    stage: "advanceDry",
    packages: [{ id: "box", location: "A01" }],
  });
  assert.equal(order.manifest.lines[0].quantity, 2);
  assert.equal(order.resolutions.rice.quantity, 4);
  assert.equal(order.portions.afterArrival.state, "waiting");
});

test("zero allocation requires explicit confirmation, produces no package and cannot deliver an empty order", () => {
  let order = createFulfillmentOrder({
    ...manifest,
    lines: [manifest.lines[0]],
  });
  order.allocations = {
    rice: {
      planId: "empty",
      itemId: "rice",
      householdKey: "family",
      quantity: 0,
      approvedBy: "coordinator",
      appliedBy: "coordinator",
      appliedAt: now,
    },
  };
  order = run(order, { type: "claim", stage: "advanceDry" });
  fails("unresolvedLine", () =>
    run(order, { type: "pack", stage: "advanceDry", packages: [] }),
  );
  fails("excessQuantity", () =>
    run(order, {
      type: "resolve",
      lineId: "rice",
      quantity: 1,
      replacement: null,
      reason: null,
    }),
  );
  order = run(order, {
    type: "resolve",
    lineId: "rice",
    quantity: 0,
    replacement: null,
    reason: null,
  });
  order = run(order, { type: "pack", stage: "advanceDry", packages: [] });
  order = run(order, { type: "arrival", arrival }, actors.bridge);
  assert.equal(readyForHandoff(order), false);
  assert.equal(order.manifest.lines[0].originalRequest, "Rice");
});
