"use client";
import { useState } from "react";
import type { AllocationDraft } from "@/lib/fulfillment/allocation";
import type {
  CoordinatorCommand,
  CoordinatorView,
} from "@/lib/fulfillment/coordinator-contracts";
import styles from "../dry.module.css";

export default function AllocationPanel({
  view,
  draft,
  disabled,
  actorId,
  send,
  clear,
}: {
  view: CoordinatorView;
  draft: AllocationDraft | null;
  disabled: boolean;
  actorId: string;
  send: (command: CoordinatorCommand) => Promise<void>;
  clear: () => void;
}) {
  const [householdRows, setHouseholdRows] = useState(["first"]);
  return (
    <section className={styles.panel}>
      <h2>Allocate available stock</h2>
      <p>
        Plan one item for the complete list of households requesting it (up to
        100). Enter the total units available for this event after setting aside
        any reserves. Use the same item key when revising a plan.
      </p>
      <p>
        Proposals are proportional to household size, rounded to whole units.
        Remaining units go to the largest fractional shares; ties use household
        key order. Scarce stock may leave households with zero. Review every
        quantity.
      </p>
      <p>
        Approval saves a planning record. Use the separate packing review below
        to apply quantities to unstarted orders. Stock is not reserved. Once
        applied to packing, this item’s plan is locked for reconciliation.
      </p>
      <form
        className={styles.form}
        onChange={clear}
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled) return;
          const data = new FormData(e.currentTarget);
          const households = householdRows.map((id) => ({
            key: String(data.get(`household-key-${id}`)),
            label: String(data.get(`household-label-${id}`)),
            size: Number(data.get(`household-size-${id}`)),
          }));
          void send({
            action: "allocationPreview",
            eventId: view.event.id,
            operationId: crypto.randomUUID(),
            input: {
              itemId: String(data.get("itemId")),
              item: String(data.get("item")),
              unit: String(data.get("unit")),
              available: Number(data.get("available")),
              households,
              eligibilityConfirmed: true,
            },
          });
        }}
      >
        <fieldset disabled={disabled} className={styles.form}>
          <label>
            Allocation item key
            <input name="itemId" required pattern="[A-Za-z0-9_-]{1,160}" />
          </label>
          <label>
            Item name
            <input name="item" required maxLength={120} />
          </label>
          <label>
            Unit or package size
            <input
              name="unit"
              required
              maxLength={120}
              placeholder="1-pound bag"
            />
          </label>
          <label>
            Available units
            <input
              name="available"
              required
              type="number"
              min={0}
              max={10000}
              step={1}
            />
          </label>
          <h3>Households requesting this item</h3>
          <p>
            Use reviewed registration references, not names alone or sheet row
            numbers.
          </p>
          {householdRows.map((id, index) => (
            <fieldset key={id} className={styles.form}>
              <legend>Household {index + 1}</legend>
              <label>
                Registration reference {index + 1}
                <input
                  name={`household-key-${id}`}
                  required
                  pattern="[A-Za-z0-9_-]{1,160}"
                />
              </label>
              <label>
                Household name {index + 1}
                <input
                  name={`household-label-${id}`}
                  required
                  maxLength={120}
                />
              </label>
              <label>
                Household size {index + 1}
                <input
                  name={`household-size-${id}`}
                  required
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                />
              </label>
              <button
                type="button"
                disabled={householdRows.length === 1}
                onClick={() => {
                  clear();
                  setHouseholdRows((rows) => rows.filter((row) => row !== id));
                }}
              >
                Remove household {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={householdRows.length >= 100}
            onClick={() => {
              clear();
              setHouseholdRows((rows) => [...rows, crypto.randomUUID()]);
            }}
          >
            Add household
          </button>
          <label>
            <input type="checkbox" required /> I verified the complete eligible
            list, household sizes, item identity and stock for this event.
          </label>
          <button>Propose quantities</button>
        </fieldset>
      </form>
      {draft && (
        <div>
          <h3>
            {draft.input.item} allocation —{" "}
            {draft.approvedAt ? "approved" : "review"}
          </h3>
          <p>
            {draft.input.available} {draft.input.unit} available ·{" "}
            {draft.input.households.reduce((n, h) => n + h.size, 0)} people ·{" "}
            {draft.input.households.length} households
          </p>
          <p>
            {draft.approvedAt
              ? `Approved ${draft.approvedAt}. Historical plans remain unchanged when a replacement is approved.`
              : `Preview expires ${draft.expiresAt}. Recheck stock before approving.`}
          </p>
          <form
            key={draft.id}
            onSubmit={(e) => {
              e.preventDefault();
              if (disabled || draft.approvedAt) return;
              const data = new FormData(e.currentTarget);
              void send({
                action: "allocationApprove",
                eventId: view.event.id,
                draftId: draft.id,
                confirmed: true,
                quantities: draft.proposed.map((p, i) => ({
                  key: p.key,
                  quantity: Number(data.get(`quantity-${i}`)),
                  reason: String(data.get(`reason-${i}`) ?? ""),
                })),
              });
            }}
          >
            <fieldset
              disabled={
                disabled || !!draft.approvedAt || draft.actor !== actorId
              }
              className={styles.form}
            >
              {draft.input.households.map((h, i) => {
                const proposed = draft.proposed.find((p) => p.key === h.key)!;
                const approved = draft.approved?.find((p) => p.key === h.key);
                return (
                  <div key={h.key}>
                    <p>
                      {h.label} · {h.key} · {h.size} people · proposed{" "}
                      {proposed.quantity} {draft.input.unit}
                    </p>
                    <label>
                      Quantity for {h.label}
                      <input
                        name={`quantity-${i}`}
                        type="number"
                        required
                        min={0}
                        max={draft.input.available}
                        step={1}
                        defaultValue={approved?.quantity ?? proposed.quantity}
                      />
                    </label>
                    <label>
                      Reason for changing {h.label}
                      <input
                        name={`reason-${i}`}
                        maxLength={1000}
                        defaultValue={approved?.reason ?? ""}
                      />
                    </label>
                  </div>
                );
              })}
              {!draft.approvedAt && (
                <>
                  <label>
                    <input type="checkbox" required /> I reviewed all
                    quantities, including zero allocations, and rechecked
                    available stock.
                  </label>
                  <button>Approve allocation plan</button>
                </>
              )}
            </fieldset>
          </form>
          {draft.approved && (
            <p>
              Approved total:{" "}
              {draft.approved.reduce((n, q) => n + q.quantity, 0)} ·
              unallocated:{" "}
              {draft.input.available -
                draft.approved.reduce((n, q) => n + q.quantity, 0)}{" "}
              {draft.input.unit}
            </p>
          )}
        </div>
      )}
      <h3>Current approved plans</h3>
      {!view.allocations.length && <p>No plans approved.</p>}
      <ul>
        {view.allocations.map((plan) => (
          <li key={plan.itemId}>
            {plan.item} ({plan.itemId}): {plan.allocated}/{plan.available}{" "}
            {plan.unit} · revision {plan.version}{" "}
            <button
              disabled={disabled}
              onClick={() =>
                void send({
                  action: "allocationRead",
                  eventId: view.event.id,
                  draftId: plan.draftId,
                })
              }
            >
              View {plan.item} plan
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
