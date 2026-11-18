import { test } from "node:test";
import assert from "node:assert/strict";
import {
  proposeAllocation,
  validateAllocation,
  type AllocationDraft,
} from "../src/lib/fulfillment/allocation";
export const allocationInput = {
  itemId: "rice",
  item: "Rice",
  unit: "1-pound bag",
  available: 12,
  eligibilityConfirmed: true as const,
  households: [
    { key: "a", label: "Example A", size: 2 },
    { key: "b", label: "Example B", size: 4 },
  ],
};
test("proportional allocations distribute exactly the available whole units", () => {
  assert.deepEqual(
    proposeAllocation(allocationInput).map((q) => q.quantity),
    [4, 8],
  );
  for (let stock = 0; stock <= 100; stock++) {
    const result = proposeAllocation({ ...allocationInput, available: stock });
    assert.equal(
      result.reduce((n, q) => n + q.quantity, 0),
      stock,
    );
    assert.ok(
      result.every((q) => Number.isInteger(q.quantity) && q.quantity >= 0),
    );
    assert.ok(result[1].quantity >= result[0].quantity);
  }
});
test("ties use stable household keys and scarce stock explicitly returns zeros", () => {
  const input = {
    ...allocationInput,
    available: 1,
    households: allocationInput.households.map((h) => ({ ...h, size: 1 })),
  };
  assert.deepEqual(
    proposeAllocation(input).map((q) => q.quantity),
    [1, 0],
  );
  assert.deepEqual(
    proposeAllocation({
      ...input,
      households: [...input.households].reverse(),
    }).map((q) => q.quantity),
    [0, 1],
  );
  assert.deepEqual(
    proposeAllocation({ ...input, available: 0 }).map((q) => q.quantity),
    [0, 0],
  );
});
test("bad weights, duplicate identities and fractional stock cannot produce plans", () => {
  for (const value of [
    { ...allocationInput, available: 1.5 },
    { ...allocationInput, available: -1 },
    { ...allocationInput, households: [] },
    {
      ...allocationInput,
      households: [
        allocationInput.households[0],
        allocationInput.households[0],
      ],
    },
    {
      ...allocationInput,
      households: [{ ...allocationInput.households[0], size: 0 }],
    },
    { ...allocationInput, eligibilityConfirmed: false },
  ])
    assert.throws(() => proposeAllocation(value));
});
test("review requires the same households, reasons for changes, and stock conservation", () => {
  const draft = {
    input: allocationInput,
    proposed: proposeAllocation(allocationInput),
  } as AllocationDraft;
  assert.equal(validateAllocation(draft, draft.proposed), 12);
  assert.throws(() =>
    validateAllocation(draft, [
      { key: "a", quantity: 3, reason: "" },
      { key: "b", quantity: 8, reason: "" },
    ]),
  );
  assert.equal(
    validateAllocation(draft, [
      { key: "a", quantity: 3, reason: "Reserve one bag" },
      { key: "b", quantity: 8, reason: "" },
    ]),
    11,
  );
  assert.throws(() =>
    validateAllocation(draft, [
      { key: "a", quantity: 5, reason: "Extra" },
      { key: "b", quantity: 8, reason: "" },
    ]),
  );
  assert.throws(() =>
    validateAllocation(draft, [draft.proposed[0], draft.proposed[0]]),
  );
});
