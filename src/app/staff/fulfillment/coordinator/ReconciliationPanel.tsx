"use client";
import { useState } from "react";
import {
  selectionTiming,
  type ReconciliationAddition,
} from "@/lib/fulfillment/reconciliation";
import type { Line } from "@/lib/fulfillment/model";
import type {
  CoordinatorCommand,
  CoordinatorView,
} from "@/lib/fulfillment/coordinator-contracts";
import type {
  ReconciliationView,
  ReconciliationPreview,
} from "@/lib/fulfillment/reconciliation";
import styles from "../dry.module.css";

export default function ReconciliationPanel({
  view,
  current,
  preview,
  disabled,
  send,
  clear,
}: {
  view: CoordinatorView;
  current: ReconciliationView | null;
  preview: ReconciliationPreview | null;
  disabled: boolean;
  send: (command: CoordinatorCommand) => Promise<void>;
  clear: () => void;
}) {
  const order = current?.order,
    review = current?.review;
  const scope = `${order?.manifest.id}-${review?.id}-${review?.status}`;
  const [addedRows, setAddedRows] = useState<{ scope: string; ids: string[] }>({
    scope: "",
    ids: [],
  });
  const [removedRows, setRemovedRows] = useState<{
    scope: string;
    ids: string[];
  }>({ scope: "", ids: [] });
  const removedIds = removedRows.scope === scope ? removedRows.ids : [];
  const addedIds = addedRows.scope === scope ? addedRows.ids : [];
  const open = !!order?.reconciliationId && review?.status === "open";
  return (
    <section className={styles.panel}>
      <h2>Reconcile changed orders</h2>
      <p>
        Pause an order before reviewing changes. This workflow accounts for all
        picked goods, clears its staged packages and restarts packing from the
        revised instructions. Gathered or delivered orders need a separate
        return/correction workflow.
      </p>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled) return;
          const data = new FormData(e.currentTarget);
          void send({
            action: "reconciliationRead",
            eventId: view.event.id,
            orderId: String(data.get("orderId")),
          });
        }}
      >
        <label>
          Order ID to reconcile
          <input
            name="orderId"
            required
            pattern="[A-Za-z0-9_-]{1,160}"
            disabled={disabled}
          />
        </label>
        <button disabled={disabled}>Load order for review</button>
      </form>
      <h3>Orders paused for reconciliation</h3>
      <ul>
        {view.reconciliations.map((r) => (
          <li key={r.id}>
            {r.household} · {r.reason}{" "}
            <button
              disabled={disabled}
              onClick={() =>
                void send({
                  action: "reconciliationRead",
                  eventId: view.event.id,
                  orderId: r.orderId,
                })
              }
            >
              Review {r.household}
            </button>
          </li>
        ))}
      </ul>
      {order && (
        <div
          key={`${order.manifest.id}-${review?.id ?? "none"}-${review?.status ?? "none"}`}
        >
          <h3>
            {order.manifest.householdLabel} · {order.control}
          </h3>
          <p>
            Order {order.manifest.id} · version {order.version} · dry{" "}
            {order.portions.advanceDry.state} · perishables{" "}
            {order.portions.afterArrival.state}
          </p>
          <p>
            {order.arrival
              ? `Checked in ${order.arrival.checkedInAt}; arrival priority will be preserved.`
              : "Not checked in. Perishables will keep waiting."}
          </p>
          {!order.manifest.lines.length && (
            <p role="alert">
              All item selections have been removed. This order stays on hold
              and cannot be handed off. Start a new review to add selections.
            </p>
          )}
          <ul>
            {order.packages.map((p) => (
              <li key={p.id}>
                {p.id} · {p.stage} · {p.location} ·{" "}
                {p.custody ? `gathered by ${p.custody}` : "staged"}
              </li>
            ))}
          </ul>
          {!open &&
            !order.deliveredAt &&
            !["cancelled", "departed"].includes(order.control) &&
            !order.packages.some((p) => p.custody || p.handedOver) && (
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (disabled) return;
                  const data = new FormData(e.currentTarget);
                  void send({
                    action: "reconciliationStart",
                    eventId: view.event.id,
                    orderId: order.manifest.id,
                    expectedVersion: order.version,
                    operationId: crypto.randomUUID(),
                    reason: String(data.get("reason")),
                  });
                }}
              >
                <label>
                  Reason for pausing this order
                  <input
                    name="reason"
                    required
                    maxLength={2000}
                    disabled={disabled}
                  />
                </label>
                <button disabled={disabled}>Pause for reconciliation</button>
              </form>
            )}
          {open && (
            <>
              <p role="status">
                Packing is paused. Notify the assigned volunteers to stop and
                keep picked goods identifiable. Original work remains in the
                audit history.
              </p>
              <form
                className={styles.form}
                onChange={clear}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (disabled) return;
                  const data = new FormData(e.currentTarget);
                  const removals = removedIds.map((id) => ({
                    lineId: id,
                    reason: String(data.get(`remove-reason-${id}`)),
                    returnedQuantity: Number(data.get(`remove-returned-${id}`)),
                    discardedQuantity: Number(
                      data.get(`remove-discarded-${id}`),
                    ),
                    goodsNote: String(data.get(`remove-note-${id}`)),
                    ...(order.allocations?.[id] &&
                    order.resolutions[id]?.replacement
                      ? {
                          budgetDiscardedQuantity: Number(
                            data.get(`remove-budget-discarded-${id}`),
                          ),
                        }
                      : {}),
                    ...(order.allocations?.[id]
                      ? {
                          stockBeforeDisposal: Number(
                            data.get(`remove-stock-${id}`),
                          ),
                        }
                      : {}),
                  }));
                  const additions = addedIds.map((id) => ({
                    lineId: id,
                    category: String(
                      data.get(`new-category-${id}`),
                    ) as ReconciliationAddition["category"],
                    reason: String(data.get(`new-reason-${id}`)),
                    stockConfirmed: true as const,
                    ...(data.get(`new-stock-${id}`)
                      ? { available: Number(data.get(`new-stock-${id}`)) }
                      : {}),
                  }));
                  const newLines: Line[] = additions.map((a) => ({
                    id: a.lineId,
                    originalRequest: String(
                      data.get(`new-request-${a.lineId}`),
                    ),
                    item: String(data.get(`new-item-${a.lineId}`)),
                    quantity: Number(data.get(`new-quantity-${a.lineId}`)),
                    unit: String(data.get(`new-unit-${a.lineId}`)),
                    shelf: String(data.get(`new-shelf-${a.lineId}`)),
                    ...selectionTiming(a.category),
                  }));
                  const manifest = {
                    ...order.manifest,
                    householdLabel: String(data.get("household")),
                    notes: String(data.get("notes")),
                    dietary: String(data.get("dietary")) || null,
                    source: {
                      ...order.manifest.source,
                      revision: String(data.get("revision")),
                    },
                    lines: [
                      ...order.manifest.lines.flatMap((line, i) =>
                        removedIds.includes(line.id)
                          ? []
                          : [
                              {
                                ...line,
                                originalRequest: String(
                                  data.get(`request-${i}`),
                                ),
                                quantity: order.allocations?.[line.id]
                                  ? line.quantity
                                  : Number(data.get(`requested-${i}`)),
                              },
                            ],
                      ),
                      ...newLines,
                    ],
                  };
                  const adjustments = Object.entries(
                    order.allocations ?? {},
                  ).flatMap(([lineId, allocation], i) => {
                    if (removedIds.includes(lineId)) return [];
                    const budget = view.allocations.find(
                      (a) => a.itemId === allocation.itemId,
                    );
                    const quantity = Number(data.get(`target-${i}`)),
                      available = Number(data.get(`stock-${i}`));
                    return quantity === allocation.quantity &&
                      available === budget?.available
                      ? []
                      : [
                          {
                            lineId,
                            quantity,
                            available,
                            reason: String(data.get(`adjustment-${i}`)),
                          },
                        ];
                  });
                  void send({
                    action: "reconciliationPreview",
                    eventId: view.event.id,
                    reviewId: review.id,
                    operationId: crypto.randomUUID(),
                    manifest,
                    additions,
                    removals,
                    adjustments,
                  });
                }}
              >
                <fieldset disabled={disabled} className={styles.form}>
                  <label>
                    Reviewed household name
                    <input
                      name="household"
                      required
                      defaultValue={order.manifest.householdLabel}
                    />
                  </label>
                  <label>
                    Reviewed source revision
                    <input
                      name="revision"
                      required
                      defaultValue={order.manifest.source.revision}
                    />
                  </label>
                  <label>
                    Revised packing notes
                    <textarea
                      name="notes"
                      maxLength={4000}
                      defaultValue={order.manifest.notes}
                    />
                  </label>
                  <label>
                    Revised dietary instructions
                    <textarea
                      name="dietary"
                      maxLength={2000}
                      defaultValue={order.manifest.dietary ?? ""}
                    />
                  </label>
                  {order.manifest.lines.map((line, i) => (
                    <div key={line.id}>
                      <p>
                        {line.item} · {line.unit} ·{" "}
                        {line.stage === "advanceDry"
                          ? "Advance dry"
                          : "After arrival"}{" "}
                        · {line.storage} · {line.shelf}
                      </p>
                      <label>
                        <input
                          type="checkbox"
                          checked={removedIds.includes(line.id)}
                          onChange={(e) => {
                            clear();
                            setRemovedRows({
                              scope,
                              ids: e.target.checked
                                ? [...removedIds, line.id]
                                : removedIds.filter((id) => id !== line.id),
                            });
                          }}
                        />{" "}
                        Remove selection: {line.item}
                      </label>
                      {removedIds.includes(line.id) && (
                        <div className={styles.form}>
                          <p>
                            Original request: {line.originalRequest}. Packing
                            target:{" "}
                            {order.allocations?.[line.id]?.quantity ??
                              line.quantity}{" "}
                            {line.unit}. Recorded picked quantity:{" "}
                            {order.resolutions[line.id]?.quantity ?? 0}. Include
                            any unrecorded loose goods in the returned/discarded
                            counts. Package dispositions are recorded separately
                            when applying.
                          </p>
                          <label>
                            Removal reason for {line.item}
                            <input
                              name={`remove-reason-${line.id}`}
                              required
                              maxLength={2000}
                            />
                          </label>
                          <label>
                            Returned quantity for {line.item}
                            <input
                              name={`remove-returned-${line.id}`}
                              type="number"
                              min={0}
                              max={10000}
                              required
                              defaultValue={
                                order.resolutions[line.id]?.quantity ?? 0
                              }
                            />
                          </label>
                          <label>
                            Discarded quantity for {line.item}
                            <input
                              name={`remove-discarded-${line.id}`}
                              type="number"
                              min={0}
                              max={10000}
                              required
                              defaultValue={0}
                            />
                          </label>
                          {order.allocations?.[line.id] &&
                            order.resolutions[line.id]?.replacement && (
                              <label>
                                Discarded original-item units for {line.item}
                                <input
                                  name={`remove-budget-discarded-${line.id}`}
                                  type="number"
                                  min={0}
                                  max={10000}
                                  required
                                  defaultValue={0}
                                />
                                <span>
                                  Recorded substitute:{" "}
                                  {order.resolutions[line.id].replacement}. Only
                                  discarded original-item units reduce this
                                  allocation budget. Reconcile substitute
                                  inventory separately in your stock records.
                                </span>
                              </label>
                            )}
                          <label>
                            Removed goods note for {line.item}
                            <input
                              name={`remove-note-${line.id}`}
                              required
                              maxLength={2000}
                            />
                          </label>
                          {order.allocations?.[line.id] && (
                            <>
                              <label>
                                Reviewed stock before disposal for {line.item}
                                <input
                                  name={`remove-stock-${line.id}`}
                                  type="number"
                                  min={0}
                                  max={10000}
                                  required
                                  defaultValue={
                                    view.allocations.find(
                                      (a) =>
                                        a.itemId ===
                                        order.allocations![line.id].itemId,
                                    )?.available
                                  }
                                />
                              </label>
                              <p>
                                The approved share is released. Returned goods
                                do not increase total stock. Discarded units are
                                subtracted from this reviewed total; the result
                                must cover other households.
                              </p>
                            </>
                          )}
                          {!order.allocations?.[line.id] && (
                            <p>
                              This selection has no allocation budget. Record
                              returns/discards in your physical stock records;
                              software will not infer an inventory increase.
                            </p>
                          )}
                        </div>
                      )}
                      <fieldset
                        disabled={removedIds.includes(line.id)}
                        className={styles.form}
                      >
                        <label>
                          Original request for {line.item}
                          <input
                            name={`request-${i}`}
                            required
                            maxLength={2000}
                            defaultValue={line.originalRequest}
                          />
                        </label>
                        {!order.allocations?.[line.id] && (
                          <label>
                            Revised quantity for {line.item}
                            <input
                              name={`requested-${i}`}
                              type="number"
                              min={1}
                              max={10000}
                              required
                              defaultValue={line.quantity}
                            />
                          </label>
                        )}
                      </fieldset>
                    </div>
                  ))}
                  {Object.entries(order.allocations ?? {}).map(
                    ([lineId, allocation], i) => {
                      if (removedIds.includes(lineId)) return null;
                      const line = order.manifest.lines.find(
                        (l) => l.id === lineId,
                      )!;
                      const budget = view.allocations.find(
                        (a) => a.itemId === allocation.itemId,
                      );
                      return (
                        <div key={lineId}>
                          <h4>Reconcile allocation: {line.item}</h4>
                          <p>
                            This order currently has {allocation.quantity}{" "}
                            {line.unit}. The event currently allocates{" "}
                            {budget?.allocated} of {budget?.available} units
                            across all households.
                          </p>
                          <label>
                            Revised allocation for {line.item}
                            <input
                              name={`target-${i}`}
                              type="number"
                              min={0}
                              max={10000}
                              required
                              defaultValue={allocation.quantity}
                            />
                          </label>
                          <label>
                            Revised total stock for {line.item}
                            <input
                              name={`stock-${i}`}
                              type="number"
                              min={0}
                              max={10000}
                              required
                              defaultValue={budget?.available}
                            />
                          </label>
                          <label>
                            Allocation change reason for {line.item}
                            <input name={`adjustment-${i}`} maxLength={2000} />
                          </label>
                        </div>
                      );
                    },
                  )}
                  <h4>New item selections</h4>
                  <p>
                    Confirm the household’s new request and a quantity based on
                    household size and available stock. Existing items must be
                    edited above. Select a food category explicitly: only
                    shelf-stable goods may be prepared before check-in.
                  </p>
                  <p>
                    Use the exact item name and unit from an existing allocation
                    budget when applicable. A budget must already be released to
                    packing; its revised total stock must cover every household,
                    including this new selection. Items without a plan use the
                    manually reviewed quantity; this does not reserve inventory.
                  </p>
                  <ul>
                    {view.allocations.map((a) => (
                      <li key={a.itemId}>
                        {a.item} · {a.unit} · {a.allocated}/{a.available}{" "}
                        allocated ·{" "}
                        {a.packingPlanId ? "Released" : "Not yet released"}
                      </li>
                    ))}
                  </ul>
                  {addedIds.map((id, i) => (
                    <fieldset key={id} className={styles.form}>
                      <legend>New selection {i + 1}</legend>
                      <label>
                        New selection {i + 1} request
                        <input
                          name={`new-request-${id}`}
                          required
                          maxLength={2000}
                        />
                      </label>
                      <label>
                        New selection {i + 1} item
                        <input
                          name={`new-item-${id}`}
                          required
                          maxLength={2000}
                        />
                      </label>
                      <label>
                        New selection {i + 1} quantity
                        <input
                          name={`new-quantity-${id}`}
                          type="number"
                          min={1}
                          max={10000}
                          required
                        />
                      </label>
                      <label>
                        New selection {i + 1} unit
                        <input
                          name={`new-unit-${id}`}
                          required
                          maxLength={160}
                        />
                      </label>
                      <label>
                        New selection {i + 1} shelf
                        <input
                          name={`new-shelf-${id}`}
                          required
                          maxLength={160}
                        />
                      </label>
                      <label>
                        New selection {i + 1} category
                        <select
                          name={`new-category-${id}`}
                          aria-label={`New selection ${i + 1} category`}
                          defaultValue=""
                          required
                        >
                          <option value="">Choose preparation category</option>
                          <option value="shelfStable">
                            Shelf-stable — advance dry packing
                          </option>
                          <option value="produce">
                            Produce — after check-in
                          </option>
                          <option value="refrigerated">
                            Refrigerated — after check-in
                          </option>
                          <option value="frozen">
                            Frozen — after check-in
                          </option>
                          <option value="otherPerishable">
                            Other perishable — after check-in
                          </option>
                        </select>
                      </label>
                      <label>
                        New selection {i + 1} revised total stock
                        <input
                          name={`new-stock-${id}`}
                          type="number"
                          min={0}
                          max={10000}
                        />
                      </label>
                      <p>
                        Required for an item with an allocation budget. Leave
                        blank for items without a plan.
                      </p>
                      <label>
                        New selection {i + 1} review reason
                        <input
                          name={`new-reason-${id}`}
                          required
                          maxLength={2000}
                        />
                      </label>
                      <label>
                        <input type="checkbox" required /> I verified the new
                        request, item identity, household quantity, available
                        stock and preparation category for selection {i + 1}.
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          clear();
                          setAddedRows({
                            scope,
                            ids: addedIds.filter((key) => key !== id),
                          });
                        }}
                      >
                        Remove new selection {i + 1}
                      </button>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    disabled={
                      addedIds.length >= 100 ||
                      order.manifest.lines.length + addedIds.length >= 200
                    }
                    onClick={() => {
                      clear();
                      setAddedRows({
                        scope,
                        ids: [...addedIds, `new-${crypto.randomUUID()}`],
                      });
                    }}
                  >
                    Add new item selection
                  </button>
                  <button>Preview reconciliation</button>
                </fieldset>
              </form>
              {preview?.reviewId === review.id && (
                <form
                  key={preview.id}
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (disabled) return;
                    const data = new FormData(e.currentTarget);
                    void send({
                      action: "reconciliationApply",
                      eventId: view.event.id,
                      previewId: preview.id,
                      confirmed: true,
                      goodsAccountedFor: true,
                      stagingCleared: true,
                      workNote: String(data.get("workNote")),
                      packages: order.packages.map((p, i) => ({
                        id: p.id,
                        disposition: String(data.get(`disposition-${i}`)) as
                          "retainedForRepack" | "returnedToStock" | "discarded",
                        note: String(data.get(`packageNote-${i}`)),
                      })),
                    });
                  }}
                >
                  <h4>Reconciliation preview</h4>
                  <p>
                    All portions restart; existing packages and item outcomes
                    are retained in the audit, not marked as delivered. Preview
                    expires {preview.expiresAt}.
                  </p>
                  <p>
                    Household: {order.manifest.householdLabel} →{" "}
                    {preview.manifest.householdLabel}
                  </p>
                  <p>
                    Notes: {order.manifest.notes || "None"} →{" "}
                    {preview.manifest.notes || "None"}
                  </p>
                  <p>
                    Dietary: {order.manifest.dietary ?? "None"} →{" "}
                    {preview.manifest.dietary ?? "None"}
                  </p>
                  <ul>
                    {preview.manifest.lines.map((line) => (
                      <li key={line.id}>
                        {line.item}:{" "}
                        {order.manifest.lines.find((l) => l.id === line.id)
                          ?.quantity ?? "new"}{" "}
                        → {line.quantity} {line.unit} ·{" "}
                        {line.stage === "advanceDry"
                          ? "Advance dry"
                          : "After check-in"}{" "}
                        · Request: {line.originalRequest}
                      </li>
                    ))}
                  </ul>
                  {!preview.manifest.lines.length && (
                    <p role="alert">
                      Every selection will be removed. Both packing portions
                      become not required; the order remains on hold and is not
                      delivered.
                    </p>
                  )}
                  <h4>Selections to remove</h4>
                  <ul>
                    {(preview.removals ?? []).map((r) => (
                      <li key={r.lineId}>
                        REMOVE: {r.line.item} · original request:{" "}
                        {r.line.originalRequest} · {r.line.quantity}{" "}
                        {r.line.unit} requested · {r.recordedQuantity} recorded
                        picked · {r.returnedQuantity} returned ·{" "}
                        {r.discardedQuantity} discarded. {r.reason}.{" "}
                        {r.goodsNote}.
                        {r.allocation
                          ? ` Release ${r.allocation.quantity} allocated units; reviewed total stock ${r.stockBeforeDisposal} minus ${r.budgetDiscardedQuantity} discarded original-item units = ${r.stockBeforeDisposal! - r.budgetDiscardedQuantity}.`
                          : " No allocation budget; physical stock records require manual reconciliation."}
                      </li>
                    ))}
                  </ul>
                  <h4>New selections to include in repacking</h4>
                  <ul>
                    {(preview.additions ?? []).map((a) => {
                      const line = preview.manifest.lines.find(
                        (line) => line.id === a.lineId,
                      )!;
                      return (
                        <li key={a.lineId}>
                          NEW: {line.item} · {line.quantity} {line.unit} ·{" "}
                          {line.shelf} ·{" "}
                          {line.stage === "advanceDry"
                            ? "Advance dry"
                            : "After check-in"}{" "}
                          ·{" "}
                          {
                            {
                              shelfStable: "Shelf-stable",
                              produce: "Produce",
                              refrigerated: "Refrigerated",
                              frozen: "Frozen",
                              otherPerishable: "Other perishable",
                            }[a.category]
                          }
                          . {a.reason}
                          {a.budget
                            ? ` Event allocation: ${a.budget.previousAllocated} → ${a.budget.previousAllocated + a.budget.quantity}; reviewed stock ${a.budget.available}.`
                            : " Quantity and stock manually reviewed; no allocation plan."}
                        </li>
                      );
                    })}
                  </ul>
                  <ul>
                    {preview.adjustments.map((a) => (
                      <li key={a.lineId}>
                        Allocation {a.itemId}: {a.previousQuantity} →{" "}
                        {a.quantity}; event total {a.previousAllocated} →{" "}
                        {a.previousAllocated - a.previousQuantity + a.quantity};
                        available {a.previousAvailable} → {a.available}.{" "}
                        {a.reason}
                      </li>
                    ))}
                  </ul>
                  <fieldset disabled={disabled} className={styles.form}>
                    {order.packages.map((p, i) => (
                      <div key={p.id}>
                        <label>
                          Disposition for package {p.id}
                          <select
                            aria-label={`Disposition for package ${p.id}`}
                            name={`disposition-${i}`}
                            required
                            defaultValue=""
                          >
                            <option value="">
                              Confirm physical disposition
                            </option>
                            <option value="retainedForRepack">
                              Unpacked and retained for repacking
                            </option>
                            <option value="returnedToStock">
                              Returned to stock
                            </option>
                            <option value="discarded">Discarded</option>
                          </select>
                        </label>
                        <label>
                          Disposition note for package {p.id}
                          <input
                            name={`packageNote-${i}`}
                            required
                            maxLength={2000}
                          />
                        </label>
                      </div>
                    ))}
                    <label>
                      Picked goods and repack instructions
                      <textarea name="workNote" required maxLength={2000} />
                    </label>
                    <label>
                      <input type="checkbox" required /> I accounted for all
                      picked goods, including loose items, and notified the
                      assigned volunteers.
                    </label>
                    <label>
                      <input type="checkbox" required /> I cleared this order’s
                      staging positions and verified the revised stock and
                      instructions.
                    </label>
                    <button>Apply changes and restart packing</button>
                  </fieldset>
                </form>
              )}
              <details>
                <summary>Abandon changes without moving goods</summary>
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (disabled) return;
                    const data = new FormData(e.currentTarget);
                    void send({
                      action: "reconciliationCancel",
                      eventId: view.event.id,
                      reviewId: review.id,
                      expectedVersion: order.version,
                      goodsUnchanged: true,
                      reason: String(data.get("reason")),
                    });
                  }}
                >
                  <label>
                    Reason for abandoning changes
                    <input
                      name="reason"
                      required
                      maxLength={2000}
                      disabled={disabled}
                    />
                  </label>
                  <label>
                    <input type="checkbox" required disabled={disabled} /> No
                    goods, package contents or staging positions have changed.
                  </label>
                  <button disabled={disabled}>
                    Keep original work and end review
                  </button>
                </form>
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
