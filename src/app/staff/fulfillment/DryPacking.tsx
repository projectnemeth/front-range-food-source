"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import type { Command } from "@/lib/fulfillment/model";
import type { DryDetail, DryResponse } from "@/lib/fulfillment/views";
import styles from "./dry.module.css";

const messages: Record<string, string> = {
  forbidden: "Your account does not have dry-packing access for this event.",
  eventDisabled: "This event is not enabled or is closed.",
  staleVersion:
    "This order changed. Review the refreshed checklist before trying again.",
  portionUnavailable: "Another volunteer has already claimed this portion.",
  exceptionNeedsApproval:
    "A coordinator must approve the shortage or substitution before packing.",
  locationOccupied:
    "That position belongs to another order. Choose a different position.",
  locationFull: "That position cannot hold this many packages.",
  notAssigned: "Only the assigned volunteer can change this checklist.",
  orderInactive: "This order is on hold or is no longer active.",
  unauthorized: "Your session has expired. Sign in again.",
  notEnabled: "Phase Two is not enabled.",
};
const message = (code: string) =>
  messages[code] ??
  `Could not save (${code}). Review the order or ask the coordinator.`;
type Pending = {
  eventId: string;
  orderId: string;
  operationId: string;
  expectedVersion: number;
  command: Command;
};

export default function DryPacking() {
  const { user, loading } = useAuth();
  const [loginError, setLoginError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [event, setEvent] = useState("");
  if (loading) return <p>Loading staff session…</p>;
  if (!user)
    return (
      <section className={styles.shell}>
        <p className={styles.eyebrow}>Front Range Food Source · Staff</p>
        <h1>Dry packing</h1>
        <p>
          Sign in with your staff account. A food-client registration is not
          required.
        </p>
        <form
          className={styles.form}
          onSubmit={async (e) => {
            e.preventDefault();
            const fields = new FormData(e.currentTarget);
            setSigningIn(true);
            setLoginError("");
            try {
              await signInWithEmailAndPassword(
                auth,
                String(fields.get("email")),
                String(fields.get("password")),
              );
            } catch {
              setLoginError(
                "Sign-in failed. Check your staff email and password.",
              );
            } finally {
              setSigningIn(false);
            }
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={signingIn}>
            {signingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p role="alert">{loginError}</p>
      </section>
    );
  return (
    <Workspace key={user.uid} user={user} event={event} setEvent={setEvent} />
  );
}

function Workspace({
  user,
  event,
  setEvent,
}: {
  user: User;
  event: string;
  setEvent: (value: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [cursor, setCursor] = useState("");
  const [data, setData] = useState<DryResponse | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [lastRead, setLastRead] = useState(0);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const requestSequence = useRef(0);
  const sending = useRef(false);

  const read = useCallback(async () => {
    if (!event) return;
    const sequence = ++requestSequence.current;
    try {
      const token = await user.getIdToken();
      const query = new URLSearchParams({ eventId: event });
      if (cursor) query.set("cursor", cursor);
      if (selected) query.set("orderId", selected);
      const response = await fetch(`/api/fulfillment/dry?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (sequence !== requestSequence.current) return;
      if (!response.ok) {
        setData(null);
        setLastRead(0);
        setError(message(body.error));
        return;
      }
      setData(body);
      setLastRead(Date.now());
      setNow(Date.now());
    } catch {
      if (sequence === requestSequence.current) {
        setLastRead(0);
        setError("Connection interrupted. Refresh before continuing.");
      }
    }
  }, [event, cursor, selected, user]);

  useEffect(() => {
    const sequenceRef = requestSequence;
    const start = setTimeout(() => void read(), 0);
    const polling = setInterval(() => {
      if (!document.hidden) void read();
    }, 5000);
    const clock = setInterval(() => {
      setNow(Date.now());
      setOnline(navigator.onLine);
    }, 1000);
    const focus = () => void read();
    window.addEventListener("focus", focus);
    return () => {
      clearTimeout(start);
      clearInterval(polling);
      clearInterval(clock);
      window.removeEventListener("focus", focus);
      ++sequenceRef.current;
    };
  }, [read]);
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const fresh = online && lastRead > 0 && now - lastRead < 15000;
  const disabled = busy || !!pending || !fresh;
  const send = async (operation: Pending) => {
    if (sending.current || !navigator.onLine) return;
    sending.current = true;
    setBusy(true);
    setPending(operation);
    setError("");
    setSaved("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/fulfillment/dry", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(operation),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (response.status >= 500) throw new Error("unknownOutcome");
      setPending(null);
      if (response.ok) setSaved("Saved. Checklist refreshed.");
      else setError(message(body.error));
      await read();
    } catch {
      setError(
        "Save outcome is unknown. Retry this same action to confirm it; do not start another action.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const act = (command: Command) => {
    if (!data?.detail || disabled) return;
    void send({
      eventId: event,
      orderId: data.detail.id,
      operationId: crypto.randomUUID(),
      expectedVersion: data.detail.version,
      command,
    });
  };

  return (
    <section className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Front Range Food Source · Staff</p>
          <h1>Dry packing</h1>
          <p>
            Prepare shelf-stable goods ahead of pickup. Perishables wait for
            check-in.
          </p>
        </div>
        <button disabled={busy || !!pending} onClick={() => void signOut(auth)}>
          Sign out
        </button>
      </header>
      <p>
        <Link href="/staff/fulfillment/coordinator">
          Coordinator setup and imports
        </Link>
      </p>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || pending) return;
          const value = String(
            new FormData(e.currentTarget).get("event"),
          ).trim();
          ++requestSequence.current;
          setData(null);
          setLastRead(0);
          setSelected("");
          setCursor("");
          setError("");
          setSaved("");
          setEvent(value);
        }}
      >
        <label>
          Pickup event ID
          <input
            name="event"
            defaultValue={event}
            required
            pattern="[A-Za-z0-9_-]{1,160}"
            disabled={busy || !!pending}
          />
        </label>
        <button disabled={busy || !!pending}>Open event</button>
        <button
          type="button"
          disabled={!event || busy}
          onClick={() => {
            setError("");
            void read();
          }}
        >
          Refresh
        </button>
      </form>
      {event && (
        <p className={fresh ? styles.live : styles.warning}>
          {fresh
            ? `Connected · event ${event} · ${data?.role ?? "staff"}`
            : "Not synchronized — changes are paused until refreshed."}
        </p>
      )}
      <p role="alert" className={styles.warning}>
        {error}
      </p>
      <p role="status">{saved}</p>
      {pending && (
        <button disabled={busy || !online} onClick={() => void send(pending)}>
          Retry same save
        </button>
      )}
      <div className={styles.columns}>
        <aside className={styles.panel}>
          <h2>Orders</h2>
          {!event && <p>Enter the event ID supplied by your coordinator.</p>}
          {data && !data.orders.length && <p>No orders on this page.</p>}
          {data?.orders.map((order) => (
            <button
              className={styles.order}
              key={order.id}
              disabled={busy || !!pending}
              aria-pressed={selected === order.id}
              onClick={() => {
                ++requestSequence.current;
                setLastRead(0);
                setData((old) => (old ? { ...old, detail: null } : null));
                setSelected(order.id);
                setError("");
                setSaved("");
              }}
            >
              <strong>{order.household}</strong>
              <span>
                {order.id} ·{" "}
                {order.control !== "active"
                  ? order.control
                  : order.dry.state === "packed"
                    ? "Dry staged"
                    : order.dry.state}
              </span>
              <small>
                {order.dry.owner
                  ? `Assigned to ${order.dry.owner}`
                  : "Not assigned"}
              </small>
            </button>
          ))}
          <div className={styles.toolbar}>
            <button
              disabled={!cursor || busy || !!pending}
              onClick={() => {
                ++requestSequence.current;
                setLastRead(0);
                setCursor("");
              }}
            >
              First page
            </button>
            <button
              disabled={!data?.nextCursor || busy || !!pending}
              onClick={() => {
                ++requestSequence.current;
                setLastRead(0);
                setCursor(data!.nextCursor!);
              }}
            >
              Next page
            </button>
          </div>
        </aside>
        <article className={styles.panel}>
          {data?.detail ? (
            <Checklist
              key={data.detail.id}
              detail={data.detail}
              data={data}
              disabled={disabled}
              act={act}
            />
          ) : (
            <>
              <h2>Pick an order</h2>
              <p>
                Claim its dry portion, follow the shelf checklist, then record
                where each package is staged.
              </p>
            </>
          )}
        </article>
      </div>
    </section>
  );
}

function Checklist({
  detail,
  data,
  disabled,
  act,
}: {
  detail: DryDetail;
  data: DryResponse;
  disabled: boolean;
  act: (command: Command) => void;
}) {
  const owned =
    detail.dry.owner === data.actorId &&
    detail.dry.state === "picking" &&
    detail.control === "active";
  const resolved = detail.lines.every((line) => {
    const outcome = detail.resolutions[line.id];
    return (
      outcome &&
      ((outcome.quantity === line.quantity && !outcome.replacement) ||
        outcome.approvedBy)
    );
  });
  const supplied = detail.lines.some(
    (line) => (detail.resolutions[line.id]?.quantity ?? 0) > 0,
  );
  return (
    <>
      <p className={styles.eyebrow}>Order {detail.id}</p>
      <h2>{detail.household}</h2>
      <p>
        <strong>Dietary instructions:</strong>{" "}
        {detail.dietary ?? "Not recorded"}
      </p>
      {detail.notes && (
        <p>
          <strong>Notes:</strong> {detail.notes}
        </p>
      )}
      <p>
        {detail.perishableCount} perishable request(s) reserved for after
        check-in.
      </p>
      {detail.control !== "active" && (
        <p className={styles.warning}>
          Order {detail.control}. Contact the coordinator.
        </p>
      )}
      {detail.dry.state === "queued" && (
        <button
          disabled={disabled || detail.control !== "active"}
          onClick={() => act({ type: "claim", stage: "advanceDry" })}
        >
          Claim dry portion
        </button>
      )}
      {detail.dry.state === "picking" && (
        <p>
          {owned
            ? "You are packing this order."
            : `Assigned to ${detail.dry.owner}.`}
        </p>
      )}
      {detail.reconciliationId && (
        <p role="alert">
          Coordinator reconciliation in progress. Stop packing and keep all
          goods identifiable. {detail.holdReason}
        </p>
      )}
      {detail.dry.state === "notRequired" && <p>No dry items requested.</p>}
      <ul className={styles.lines}>
        {detail.lines.map((line) => {
          const outcome = detail.resolutions[line.id];
          const exception =
            outcome &&
            (outcome.quantity !== line.quantity || !!outcome.replacement);
          return (
            <li key={line.id}>
              <strong>{line.item}</strong>
              <p>
                {line.quantity} {line.unit} · {line.shelf}
              </p>
              {line.allocationPlanId && (
                <p>
                  Coordinator allocation · plan {line.allocationPlanId}. Before
                  allocation: {line.beforeAllocation} {line.unit}.
                </p>
              )}
              {line.quantity === 0 && (
                <p>No stock allocated. Confirm zero; do not pick this item.</p>
              )}
              {outcome && (
                <p>
                  {outcome.quantity} packed
                  {outcome.replacement
                    ? ` · substitute: ${outcome.replacement}`
                    : ""}
                  {exception
                    ? outcome.approvedBy
                      ? " · exception approved"
                      : " · awaiting coordinator"
                    : " · picked"}
                </p>
              )}
              {outcome?.reason && <p>{outcome.reason}</p>}
              <button
                disabled={disabled || !owned}
                onClick={() =>
                  act({
                    type: "resolve",
                    lineId: line.id,
                    quantity: line.quantity,
                    replacement: null,
                    reason: null,
                  })
                }
              >
                {line.quantity === 0 ? "Confirm zero for" : "Picked"}{" "}
                {line.item}
              </button>
              {owned && (
                <details>
                  <summary>Shortage or substitution</summary>
                  <form
                    className={styles.form}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fields = new FormData(e.currentTarget);
                      act({
                        type: "resolve",
                        lineId: line.id,
                        quantity: Number(fields.get("quantity")),
                        replacement:
                          String(fields.get("replacement") ?? "").trim() ||
                          null,
                        reason: String(fields.get("reason")),
                      });
                    }}
                  >
                    <label>
                      Quantity packed
                      <input
                        name="quantity"
                        type="number"
                        min="0"
                        max={line.quantity}
                        step="1"
                        defaultValue={outcome?.quantity ?? line.quantity}
                        required
                      />
                    </label>
                    <label>
                      Replacement item, if any
                      <input name="replacement" maxLength={2000} />
                    </label>
                    <label>
                      Reason
                      <input name="reason" maxLength={2000} required />
                    </label>
                    <button disabled={disabled}>Save issue</button>
                  </form>
                </details>
              )}
              {exception &&
                !outcome.approvedBy &&
                data.role === "coordinator" && (
                  <form
                    className={styles.toolbar}
                    onSubmit={(e) => {
                      e.preventDefault();
                      act({
                        type: "approve",
                        lineId: line.id,
                        reason: String(
                          new FormData(e.currentTarget).get("reason"),
                        ),
                      });
                    }}
                  >
                    <label>
                      Review reason
                      <input name="reason" required maxLength={2000} />
                    </label>
                    <button disabled={disabled || detail.control !== "active"}>
                      Approve exception
                    </button>
                  </form>
                )}
            </li>
          );
        })}
      </ul>
      {owned && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            const fields = new FormData(e.currentTarget);
            const count = supplied ? Number(fields.get("count")) : 0;
            act({
              type: "pack",
              stage: "advanceDry",
              packages: Array.from({ length: count }, (_, index) => ({
                id: `D${index + 1}`,
                location: String(fields.get("location")),
              })),
            });
          }}
        >
          <h3>Pack and stage</h3>
          <p>
            Verify the checklist, label each package with the event, order ID
            and D1, D2, etc., then place them at the selected position.
          </p>
          {supplied ? (
            <>
              <label>
                Number of packages
                <input
                  name="count"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Staging position
                <select name="location" required defaultValue="">
                  <option value="" disabled>
                    Select position
                  </option>
                  {data.locations
                    .filter(
                      (location) =>
                        !location.orderId || location.orderId === detail.id,
                    )
                    .map((location) => (
                      <option value={location.code} key={location.code}>
                        {location.code} · capacity {location.capacity}
                      </option>
                    ))}
                </select>
              </label>
            </>
          ) : (
            <p>
              No supplied items. All shortages require coordinator approval; no
              empty packages will be created.
            </p>
          )}
          <label>
            <input type="checkbox" required /> I checked the dietary notes,
            contents, labels and package count.
          </label>
          <button disabled={disabled || !resolved}>
            Confirm dry packed and staged
          </button>
        </form>
      )}
      {detail.dry.state === "packed" && (
        <div className={styles.complete}>
          <h3>Dry portion staged</h3>
          {detail.packages.map((pkg) => (
            <p key={pkg.id}>
              {pkg.id} — {pkg.location}
            </p>
          ))}
          <p>Perishable packing remains in the existing check-in workflow.</p>
        </div>
      )}
    </>
  );
}
