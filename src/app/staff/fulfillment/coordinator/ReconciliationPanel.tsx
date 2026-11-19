"use client";
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
                  const manifest = {
                    ...order.manifest,
                    householdLabel: String(data.get("household")),
                    notes: String(data.get("notes")),
                    dietary: String(data.get("dietary")) || null,
                    source: {
                      ...order.manifest.source,
                      revision: String(data.get("revision")),
                    },
                    lines: order.manifest.lines.map((line, i) => ({
                      ...line,
                      originalRequest: String(data.get(`request-${i}`)),
                      quantity: order.allocations?.[line.id]
                        ? line.quantity
                        : Number(data.get(`requested-${i}`)),
                    })),
                  };
                  const adjustments = Object.entries(
                    order.allocations ?? {},
                  ).flatMap(([lineId, allocation], i) => {
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
                    </div>
                  ))}
                  {Object.entries(order.allocations ?? {}).map(
                    ([lineId, allocation], i) => {
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
                        → {line.quantity} {line.unit} · {line.stage} · Request:{" "}
                        {line.originalRequest}
                      </li>
                    ))}
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
