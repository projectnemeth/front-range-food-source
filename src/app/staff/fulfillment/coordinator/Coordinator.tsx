"use client";
import Link from "next/link";
import ReconciliationPanel from "./ReconciliationPanel";
import type {
  ReconciliationView,
  ReconciliationPreview,
} from "@/lib/fulfillment/reconciliation";
import AllocationPanel from "./AllocationPanel";
import PackingAllocationPanel from "./PackingAllocationPanel";
import type {
  PackingAllocationDraft,
  PackingCandidate,
} from "@/lib/fulfillment/packing-allocation";
import type { AllocationDraft } from "@/lib/fulfillment/allocation";
import type { User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type {
  CoordinatorCommand,
  CoordinatorView,
  ImportDraft,
} from "@/lib/fulfillment/coordinator-contracts";
import styles from "../dry.module.css";

const errors: Record<string, string> = {
  reconciliationPending:
    "This order already has an open reconciliation. Load it to continue.",
  reconciliationTerminal:
    "Cancelled, departed or delivered orders require a separate correction workflow.",
  reconciliationCustody:
    "Goods have been gathered or handed over. Confirm returns through a separate workflow before reworking them.",
  reconciliationClosed: "This review is no longer open. Reload the order.",
  reconciliationIdentity:
    "Order, event and source identity must remain the same.",
  reconciliationMapping:
    "Keep existing lines and their item identities, units, preparation stages and storage classes. Add new selections separately.",
  reconciliationSelections:
    "Every added line needs exactly one new-selection review. Reload and review the new selections.",
  reconciliationSelectionTiming:
    "The new item’s preparation timing and storage must match its reviewed food category.",
  reconciliationDuplicateItem:
    "This item is already on the order. Edit its existing quantity instead of adding another line.",
  reconciliationSelectionBudget:
    "Match the existing item name and unit, release its allocation plan first, and enter the reviewed total stock. Ambiguous item budgets need correction before adding this selection.",
  reconciliationAllocatedLine:
    "Keep the original requested quantity for allocated items; use the allocation adjustment fields instead.",
  reconciliationAdjustment:
    "Allocation adjustments must name distinct existing allocated lines.",
  reconciliationStock:
    "The saved stock budget is inconsistent. No work was changed.",
  reconciliationNoChange:
    "Change an instruction or quantity before generating a preview, or abandon the review.",
  reconciliationPackages:
    "Record a disposition for every existing package exactly once.",
  locationCountConflict:
    "Staging counts changed or do not match this order. Verify the positions before proceeding.",
  allocationAlreadyReleased:
    "This item's plan is already applied to packing. Reconcile existing work before changing it.",
  allocationNotApproved: "Approve the allocation plan first.",
  packingOrderNotFound:
    "A linked order is missing or belongs to a different event.",
  packingHouseholdMismatch:
    "The order household does not match the approved plan. Review the identity link.",
  packingItemMismatch:
    "The item and unit must exactly match the approved allocation.",
  packingWorkStarted:
    "A linked order has started work, arrived or been held. No quantities were changed.",
  packingLineAlreadyAllocated:
    "An item line already has an allocation. Reconcile it before assigning another plan.",
  packingCandidateLimit:
    "This event exceeds the current 200-order linking limit. No orders were changed.",
  allocationOverStock:
    "Approved quantities exceed available stock. Reduce quantities or generate a new stock preview.",
  allocationReasonRequired:
    "Record a reason for each quantity changed from the proposal.",
  allocationHouseholdsChanged:
    "The reviewed household list changed. Generate a new preview.",
  staleAllocation:
    "Another plan for this item was approved. Reload and generate a new preview.",
  forbidden:
    "Coordinator access is required. Only an existing application administrator can create an event.",
  staleVersion:
    "Setup changed in another session. Reload the event before saving.",
  stalePreview: "The event or source records changed. Generate a new preview.",
  previewBlocked: "Resolve every blocked row before applying an import.",
  draftExpired: "This preview expired. Generate a new preview.",
  locationOccupied:
    "This position holds packages. Its capacity cannot shrink below the count and it cannot be disabled.",
  locationRequired: "Add an active staging position before enabling packing.",
  coordinatorProtected:
    "This screen cannot replace or revoke coordinator access.",
  staffAccountUnavailable:
    "That staff account is missing or disabled. Use an existing Firebase staff UID.",
  eventExists:
    "That event already exists. Load it instead of creating another.",
  operationConflict:
    "This request token belongs to a different change. Reload the event.",
  draftNotFound:
    "This preview is not available to your account. Generate a new preview.",
  setupLimitExceeded: "This setup exceeds the 200 staff or location limit.",
  notEnabled: "Phase Two is not enabled.",
  unauthorized: "Your session has expired. Sign in again.",
  invalidInput:
    "Some fields are missing or invalid. Imported records need explicit quantities, units, stages, shelves and source references.",
};
export default function Coordinator() {
  const { user, loading, profile } = useAuth();
  if (loading) return <p>Loading staff session…</p>;
  if (!user)
    return (
      <section>
        <h1>Fulfillment setup</h1>
        <p>
          <Link href="/staff/fulfillment">Sign in to the staff workspace</Link>,
          then return to coordinator setup.
        </p>
      </section>
    );
  return (
    <CoordinatorWorkspace
      key={user.uid}
      user={user}
      isAdmin={profile?.role === "ADMIN"}
    />
  );
}

function CoordinatorWorkspace({
  user,
  isAdmin,
}: {
  user: User;
  isAdmin: boolean;
}) {
  const [eventId, setEventId] = useState("");
  const [view, setView] = useState<CoordinatorView | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [allocationDraft, setAllocationDraft] =
    useState<AllocationDraft | null>(null);
  const [packingDraft, setPackingDraft] =
    useState<PackingAllocationDraft | null>(null);
  const [packingCandidates, setPackingCandidates] = useState<
    PackingCandidate[] | null
  >(null);
  const [reconciliation, setReconciliation] =
    useState<ReconciliationView | null>(null);
  const [reconciliationPreview, setReconciliationPreview] =
    useState<ReconciliationPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CoordinatorCommand | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const read = async (id: string) => {
    if (!user) return;
    const response = await fetch(
      `/api/fulfillment/coordinator?eventId=${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      setView(null);
      throw new Error(body.error);
    }
    setAllocationDraft((current) => (current?.eventId === id ? current : null));
    setReconciliation((current) =>
      current?.order.manifest.eventId === id ? current : null,
    );
    setView(body);
    setEventId(id);
  };
  const send = async (command: CoordinatorCommand) => {
    if (!user || lock.current) return;
    lock.current = true;
    setBusy(true);
    setPending(command);
    setMessage("");
    let committed = false;
    try {
      const response = await fetch("/api/fulfillment/coordinator", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (response.status >= 500) throw new Error("unknownOutcome");
      setPending(null);
      committed = true;
      if (!response.ok) {
        const fields = Array.isArray(body.fields)
          ? body.fields
              .slice(0, 5)
              .map((field: { path?: string | string[] }) =>
                typeof field.path === "string"
                  ? field.path
                  : field.path?.join("."),
              )
              .filter(Boolean)
              .join(", ")
          : "";
        setMessage(
          (errors[body.error] ?? `Request rejected (${body.error}).`) +
            (fields ? ` Check: ${fields}.` : ""),
        );
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setDraft(null);
          setAllocationDraft(null);
        }
        return;
      }
      if (body.reconciliation) {
        setReconciliation(body.reconciliation);
        setReconciliationPreview(null);
        if (body.reconciliationFinished)
          setMessage(
            command.action === "reconciliationApply"
              ? "Changes applied. Original work is audited; packing can restart."
              : "Review ended. Original work preserved.",
          );
      } else if (body.reconciliationPreview) {
        setReconciliationPreview(body.reconciliationPreview);
      } else if (body.packingDraft) {
        setPackingDraft(body.packingDraft);
      } else if (body.packingApplied) {
        setPackingDraft(null);
        setPackingCandidates(null);
        setMessage(
          "Approved quantities applied to packing. Original requests and preparation stages preserved.",
        );
      } else if (body.allocationDraft) {
        setPackingDraft(null);
        setPackingCandidates(body.packingCandidates ?? null);
        setAllocationDraft(body.allocationDraft);
        if (command.action === "allocationApprove")
          setMessage("Allocation plan approved. Packing work is unchanged.");
      } else if (body.draft) setDraft(body.draft);
      else {
        setAllocationDraft(null);
        setDraft(null);
        setMessage(
          command.action === "apply"
            ? `Import saved: ${body.count} new orders; ${body.updated ?? 0} unstarted orders updated. Existing work preserved.`
            : "Setup saved.",
        );
      }
      await read(command.eventId);
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknownOutcome";
      setMessage(
        committed
          ? (errors[code] ??
              `Could not complete refresh (${code}). Reload the event.`)
          : "Save outcome is unknown. Retry the same request before making another change.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const disabled = busy || !!pending;
  const change = (
    fields:
      | Omit<
          Extract<CoordinatorCommand, { action: "location" }>,
          "eventId" | "operationId" | "expectedVersion"
        >
      | Omit<
          Extract<CoordinatorCommand, { action: "staff" }>,
          "eventId" | "operationId" | "expectedVersion"
        >
      | { action: "setEnabled"; enabled: boolean },
  ) => {
    if (!view || disabled) return;
    void send({
      ...fields,
      eventId: view.event.id,
      operationId: crypto.randomUUID(),
      expectedVersion: view.event.version,
    });
  };
  return (
    <section className={styles.shell}>
      <p className={styles.eyebrow}>Front Range Food Source · Coordinator</p>
      <h1>Prepare a pickup event</h1>
      <p>
        Create a separate Phase Two event, configure staff and positions, then
        review mapped orders before importing.
      </p>
      <p>
        {pending ? (
          "Confirm the pending request before leaving this screen."
        ) : (
          <Link href="/staff/fulfillment">Back to dry packing</Link>
        )}
      </p>
      <p role="status">{message}</p>
      {pending && (
        <button disabled={busy} onClick={() => void send(pending)}>
          Retry same request
        </button>
      )}
      <form
        className={styles.toolbar}
        onSubmit={async (e) => {
          e.preventDefault();
          if (disabled || lock.current) return;
          lock.current = true;
          setBusy(true);
          setDraft(null);
          setMessage("");
          try {
            await read(String(new FormData(e.currentTarget).get("event")));
          } catch (error) {
            const code =
              error instanceof Error ? error.message : "connectionError";
            setMessage(errors[code] ?? "Could not load the event.");
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          Event ID
          <input
            name="event"
            defaultValue={eventId}
            required
            pattern="[A-Za-z0-9_-]{1,160}"
            disabled={disabled}
          />
        </label>
        <button disabled={disabled}>Load event</button>
      </form>
      {isAdmin && (
        <details className={styles.panel}>
          <summary>Create a new event</summary>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (disabled) return;
              const f = new FormData(e.currentTarget);
              void send({
                action: "createEvent",
                eventId: String(f.get("event")),
                operationId: crypto.randomUUID(),
                label: String(f.get("label")),
                pickupDate: String(f.get("date")),
                sourceScope: String(f.get("scope")),
                mappingVersion: String(f.get("mapping")),
              });
            }}
          >
            <label>
              New event ID
              <input name="event" required pattern="[A-Za-z0-9_-]{1,160}" />
            </label>
            <label>
              Event name
              <input name="label" required maxLength={120} />
            </label>
            <label>
              Pickup date
              <input name="date" type="date" required />
            </label>
            <label>
              Source scope (spreadsheet ID/tab ID)
              <input name="scope" required maxLength={120} />
            </label>
            <label>
              Reviewed mapping version
              <input name="mapping" required maxLength={120} />
            </label>
            <p>
              New events start disabled. Date, source scope and mapping version
              are fixed for this event.
            </p>
            <button disabled={disabled}>Create disabled event</button>
          </form>
        </details>
      )}
      {view && (
        <>
          <div className={styles.panel}>
            <h2>
              {view.event.label} · {view.event.pickupDate}
            </h2>
            <p>
              Event {view.event.id} ·{" "}
              {view.event.enabled ? "Packing enabled" : "Packing disabled"} ·
              setup version {view.event.version}
            </p>
            <p>
              Source scope: {view.event.sourceScope} · mapping:{" "}
              {view.event.mappingVersion}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                change({ action: "setEnabled", enabled: !view.event.enabled });
              }}
            >
              <label>
                <input
                  key={String(view.event.enabled)}
                  type="checkbox"
                  required
                />{" "}
                I intend to {view.event.enabled ? "pause" : "enable"} packing
                for this Phase Two event.
              </label>
              <button disabled={disabled}>
                {view.event.enabled ? "Pause packing" : "Enable packing"}
              </button>
            </form>
          </div>
          <div className={styles.columns}>
            <section className={styles.panel}>
              <h2>Staging positions</h2>
              <ul>
                {view.locations.map((location) => (
                  <li key={location.code}>
                    {location.code}: {location.count}/{location.capacity}{" "}
                    packages · {location.active ? "active" : "disabled"}
                  </li>
                ))}
              </ul>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  change({
                    action: "location",
                    code: String(f.get("code")),
                    capacity: Number(f.get("capacity")),
                    active: f.get("active") === "on",
                  });
                }}
              >
                <label>
                  Position code
                  <input name="code" required maxLength={120} />
                </label>
                <label>
                  Capacity in packages
                  <input
                    name="capacity"
                    type="number"
                    min={1}
                    max={100}
                    required
                  />
                </label>
                <label>
                  <input name="active" type="checkbox" defaultChecked /> Active
                  position
                </label>
                <button disabled={disabled}>Save position</button>
              </form>
            </section>
            <section className={styles.panel}>
              <h2>Staff access</h2>
              <ul>
                {view.staff.map((staff) => (
                  <li key={staff.uid}>
                    {staff.uid} · {staff.role} ·{" "}
                    {staff.active ? "active" : "revoked"}
                  </li>
                ))}
              </ul>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  change({
                    action: "staff",
                    uid: String(f.get("uid")),
                    role: f.get("role") as "packer" | "runner",
                    active: f.get("active") === "on",
                  });
                }}
              >
                <label>
                  Existing Firebase staff UID
                  <input name="uid" required pattern="[A-Za-z0-9_-]{1,160}" />
                </label>
                <label>
                  Staff role
                  <select name="role">
                    <option value="packer">Packer</option>
                    <option value="runner">
                      Runner (future pickup interface)
                    </option>
                  </select>
                </label>
                <label>
                  <input name="active" type="checkbox" defaultChecked /> Active
                  access
                </label>
                <button disabled={disabled}>Save staff access</button>
              </form>
            </section>
          </div>
          <ReconciliationPanel
            key={`reconciliation-${view.event.id}`}
            view={view}
            current={reconciliation}
            preview={reconciliationPreview}
            disabled={disabled}
            send={send}
            clear={() => setReconciliationPreview(null)}
          />
          <AllocationPanel
            key={view.event.id}
            view={view}
            draft={allocationDraft}
            disabled={disabled}
            actorId={user.uid}
            send={send}
            clear={() => {
              setAllocationDraft(null);
              setPackingDraft(null);
              setPackingCandidates(null);
            }}
          />
          {allocationDraft?.approvedAt &&
            allocationDraft.eventId === view.event.id && (
              <PackingAllocationPanel
                key={allocationDraft.id}
                plan={allocationDraft}
                candidates={packingCandidates}
                draft={packingDraft}
                disabled={disabled}
                released={view.allocations.some(
                  (p) =>
                    p.itemId === allocationDraft.input.itemId &&
                    !!p.packingPlanId,
                )}
                send={send}
                clear={() => setPackingDraft(null)}
              />
            )}
          <section className={styles.panel}>
            <h2>Review mapped orders</h2>
            <p>
              This accepts explicitly mapped JSON records, not a raw Google
              Sheet or CSV. It does not fetch or modify Google data. Submit at
              most ten records per preview (request limit 20 KB). Changed
              unstarted orders show both versions for review. Orders with
              existing work remain blocked for separate reconciliation.
            </p>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (disabled) return;
                try {
                  const manifests = JSON.parse(
                    String(new FormData(e.currentTarget).get("manifests")),
                  );
                  setDraft(null);
                  void send({
                    action: "preview",
                    eventId: view.event.id,
                    operationId: crypto.randomUUID(),
                    manifests,
                  });
                } catch {
                  setMessage(
                    "Enter a valid JSON array of mapped order records.",
                  );
                }
              }}
            >
              <label>
                Mapped order records
                <textarea
                  name="manifests"
                  rows={10}
                  disabled={disabled}
                  onChange={() => setDraft(null)}
                  required
                  style={{ width: "100%", fontFamily: "monospace" }}
                />
              </label>
              <button disabled={disabled}>Generate import preview</button>
            </form>
            {draft && (
              <div>
                <h3>Import preview</h3>
                <p>
                  Expires {draft.expiresAt}. No orders are written until you
                  apply this preview.
                </p>
                {draft.rows.map((row, i) => (
                  <details
                    key={i}
                    open={row.status === "blocked" || row.status === "update"}
                  >
                    <summary>
                      {row.manifest.householdLabel} — {row.status}
                    </summary>
                    <p>{row.reason}</p>
                    {row.previousManifest && (
                      <div>
                        <h4>Previously accepted order</h4>
                        <p>
                          {row.previousManifest.householdLabel} · Revision{" "}
                          {row.previousManifest.source.revision}
                        </p>
                        <p>
                          Dietary:{" "}
                          {row.previousManifest.dietary ?? "Not recorded"}
                        </p>
                        <p>Notes: {row.previousManifest.notes || "None"}</p>
                        <ul>
                          {row.previousManifest.lines.map((line) => (
                            <li key={line.id}>
                              {line.item}: {line.quantity} {line.unit} ·{" "}
                              {line.stage === "advanceDry"
                                ? "Advance dry"
                                : "After arrival"}{" "}
                              · {line.storage} · {line.shelf} · Requested:{" "}
                              {line.originalRequest}
                            </li>
                          ))}
                        </ul>
                        <h4>Proposed replacement</h4>
                      </div>
                    )}
                    <p>
                      Order {row.manifest.id} · source {row.manifest.source.key}
                    </p>
                    <p>Dietary: {row.manifest.dietary ?? "Not recorded"}</p>
                    <p>Notes: {row.manifest.notes || "None"}</p>
                    <ul>
                      {row.manifest.lines.map((line) => (
                        <li key={line.id}>
                          {line.item}: {line.quantity} {line.unit} ·{" "}
                          {line.stage === "advanceDry"
                            ? "Advance dry"
                            : "After arrival"}{" "}
                          · {line.storage} · {line.shelf} · Requested:{" "}
                          {line.originalRequest}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!disabled)
                      void send({
                        action: "apply",
                        eventId: view.event.id,
                        draftId: draft.id,
                        confirmed: true,
                      });
                  }}
                >
                  <label>
                    <input key={draft.id} type="checkbox" required /> I reviewed
                    the event, identities, quantities, instructions and
                    preparation stages.
                  </label>
                  <button
                    disabled={
                      disabled ||
                      draft.rows.some((row) => row.status === "blocked")
                    }
                  >
                    Apply reviewed import
                  </button>
                </form>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
