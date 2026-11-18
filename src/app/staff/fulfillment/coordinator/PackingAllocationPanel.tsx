"use client";
import { useState } from "react";
import type { AllocationDraft } from "@/lib/fulfillment/allocation";
import type {
  PackingAllocationDraft,
  PackingCandidate,
} from "@/lib/fulfillment/packing-allocation";
import type { CoordinatorCommand } from "@/lib/fulfillment/coordinator-contracts";
import styles from "../dry.module.css";

export default function PackingAllocationPanel({
  plan,
  candidates,
  draft,
  disabled,
  released,
  send,
  clear,
}: {
  plan: AllocationDraft;
  candidates: PackingCandidate[] | null;
  draft: PackingAllocationDraft | null;
  disabled: boolean;
  released: boolean;
  send: (command: CoordinatorCommand) => Promise<void>;
  clear: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  if (!plan.approvedAt) return null;
  return (
    <section className={styles.panel}>
      <h3>Connect {plan.input.item} to packing</h3>
      {released ? (
        <p>
          This plan has been applied to packing orders. Further changes require
          reconciliation; planning cannot overwrite these quantities.
        </p>
      ) : (
        <>
          <p>
            Link every household to its existing order and the matching item.
            Names and units must match. Review the original request and
            preparation stage before applying. Orders must be unstarted; zero
            shares remain visible on the checklist.
          </p>
          <button
            disabled={disabled}
            onClick={() =>
              void send({
                action: "allocationRead",
                eventId: plan.eventId,
                draftId: plan.id,
              })
            }
          >
            Load packing orders
          </button>
          {candidates && (
            <form
              className={styles.form}
              onChange={clear}
              onSubmit={(e) => {
                e.preventDefault();
                if (disabled) return;
                const data = new FormData(e.currentTarget);
                void send({
                  action: "packingAllocationPreview",
                  eventId: plan.eventId,
                  planId: plan.id,
                  operationId: crypto.randomUUID(),
                  links: plan.input.households.map((h, i) => ({
                    householdKey: h.key,
                    orderId: String(data.get(`order-${i}`)),
                    lineId: String(data.get(`line-${i}`)),
                  })),
                });
              }}
            >
              <fieldset disabled={disabled} className={styles.form}>
                {plan.input.households.map((h, i) => {
                  const order = candidates.find(
                    (o) => o.id === selected[h.key],
                  );
                  return (
                    <div key={h.key}>
                      <p>
                        {h.label} · {h.key} · approved{" "}
                        {plan.approved!.find((q) => q.key === h.key)!.quantity}{" "}
                        {plan.input.unit}
                      </p>
                      <label>
                        Packing order for {h.label}
                        <select
                          aria-label={`Packing order for ${h.label}`}
                          name={`order-${i}`}
                          required
                          value={selected[h.key] ?? ""}
                          onChange={(e) =>
                            setSelected((s) => ({
                              ...s,
                              [h.key]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Select matching order</option>
                          {candidates
                            .filter((o) => o.household === h.label)
                            .map((o) => (
                              <option
                                key={o.id}
                                value={o.id}
                                disabled={!o.unstarted}
                              >
                                {o.household} · {o.id}
                                {o.unstarted ? "" : " · work started or held"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Packing item for {h.label}
                        <select
                          key={order?.id ?? "empty"}
                          aria-label={`Packing item for ${h.label}`}
                          name={`line-${i}`}
                          required
                          defaultValue=""
                        >
                          <option value="">
                            Select matching item and unit
                          </option>
                          {order?.lines
                            .filter(
                              (l) =>
                                l.item === plan.input.item &&
                                l.unit === plan.input.unit,
                            )
                            .map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.item} · {l.unit} · {l.shelf} ·{" "}
                                {l.stage === "advanceDry"
                                  ? "Advance dry"
                                  : "After arrival"}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                  );
                })}
                <button>Review packing quantities</button>
              </fieldset>
            </form>
          )}
          {draft && draft.planId === plan.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!disabled)
                  void send({
                    action: "packingAllocationApply",
                    eventId: plan.eventId,
                    draftId: draft.id,
                    confirmed: true,
                  });
              }}
            >
              <h4>Packing quantity preview</h4>
              <p>
                Expires {draft.expiresAt}. This applies the entire plan
                together; no partial release.
              </p>
              <ul>
                {draft.rows.map((row) => (
                  <li key={row.householdKey}>
                    <strong>
                      {row.household}: {row.before} → {row.quantity}{" "}
                      {row.line.unit}
                    </strong>
                    <p>
                      Order {row.orderId} · {row.line.item} · {row.line.shelf} ·{" "}
                      {row.line.stage === "advanceDry"
                        ? "Advance dry"
                        : "After arrival"}
                    </p>
                    <p>Original request: {row.line.originalRequest}</p>
                    {row.quantity === 0 && (
                      <p>
                        No units allocated. Keep the request visible and confirm
                        zero during packing.
                      </p>
                    )}
                    {row.reason && <p>Coordinator adjustment: {row.reason}</p>}
                  </li>
                ))}
              </ul>
              <fieldset disabled={disabled} className={styles.form}>
                <label>
                  <input key={draft.id} type="checkbox" required /> I verified
                  all household links, items, units, zero allocations and
                  preparation stages.
                </label>
                <button>Apply approved packing quantities</button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </section>
  );
}
