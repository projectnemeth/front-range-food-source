"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  limit,
  getCountFromServer,
  where,
} from "firebase/firestore";
import { getCurrentBatchId } from "@/lib/batchUtils";
import { loadOrders, type Cursor } from "@/lib/admin-orders";
import type { Order } from "@/lib/schemas";
import { formatPickupDate } from "@/lib/dates";
import PrintLayout from "./PrintLayout";
import FulfillmentDetails from "@/components/FulfillmentDetails";
interface Batch {
  id: string;
  name: string;
}
export default function AdminDashboard() {
  const { user, profile, loading, profileError, refreshProfile } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatch] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<Cursor>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<Order[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  const [families, setFamilies] = useState<number | null>(null);
  const [recent, setRecent] = useState<number | null>(null);
  const generation = useRef(0);
  const printRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loading) return;
    if (!user || profile?.role !== "ADMIN") {
      if (!profileError) router.replace("/");
      return;
    }
    let cancelled = false;
    const initial = async () => {
      try {
        const [snap, current, all, newFamilies] = await Promise.all([
          getDocs(
            query(
              collection(db, "batches"),
              orderBy("createdAt", "desc"),
              limit(100),
            ),
          ),
          getCurrentBatchId(),
          getCountFromServer(collection(db, "users")),
          getCountFromServer(
            query(
              collection(db, "users"),
              where(
                "createdAt",
                ">=",
                new Date(Date.now() - 21 * 86400000).toISOString(),
              ),
            ),
          ),
        ]);
        if (cancelled) return;
        setBatches(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Batch));
        setBatch(current || snap.docs[0]?.id || "*");
        setFamilies(all.data().count);
        setRecent(newFamilies.data().count);
      } catch {
        if (!cancelled) {
          setError(true);
          setBusy(false);
        }
      }
    };
    void initial();
    return () => {
      cancelled = true;
    };
  }, [loading, user, profile, profileError, router, retry]);
  useEffect(() => {
    if (batchId === null) return;
    let cancelled = false;
    const version = ++generation.current;
    const load = async () => {
      setBusy(true);
      setError(false);
      setSelected(new Set());
      setPrinting([]);
      setOrders([]);
      try {
        const result = await loadOrders(batchId);
        if (cancelled || version !== generation.current) return;
        setOrders(result.orders);
        setCursor(result.cursor);
        setMore(result.more);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [batchId, retry]);
  const next = async () => {
    if (!batchId || busy) return;
    const version = generation.current;
    setBusy(true);
    try {
      const result = await loadOrders(batchId, cursor);
      if (version !== generation.current) return;
      setOrders((prev) => [...prev, ...result.orders]);
      setCursor(result.cursor);
      setMore(result.more);
    } catch {
      if (version === generation.current) setError(true);
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  const packing = async (
    order: Order,
    kind: "dryGoods" | "freshGoods",
    checked: boolean,
  ) => {
    setUpdating(order.id);
    try {
      const status = checked ? "PACKED" : "PENDING";
      await updateDoc(doc(db, "orders", order.id), {
        [`packingStatus.${kind}`]: status,
      });
      setOrders((prev) =>
        prev.map((v) =>
          v.id !== order.id
            ? v
            : {
                ...v,
                packingStatus: {
                  dryGoods: v.packingStatus?.dryGoods ?? "PENDING",
                  freshGoods: v.packingStatus?.freshGoods ?? "PENDING",
                  [kind]: status,
                },
              },
        ),
      );
    } catch {
      setError(true);
    } finally {
      setUpdating(null);
    }
  };
  const print = useCallback(
    (list: Order[]) => {
      if (!list.length || error || busy) return;
      setPrinting(list);
    },
    [busy, error],
  );
  useEffect(() => {
    if (!printing.length) return;
    const frame = requestAnimationFrame(() => {
      if (printRef.current?.querySelector("#print-container")) window.print();
    });
    return () => cancelAnimationFrame(frame);
  }, [printing]);
  if (profileError)
    return (
      <p>
        {t("fix.profileError")}{" "}
        <button onClick={() => void refreshProfile()}>{t("fix.retry")}</button>
      </p>
    );
  if (loading) return <p>{t("common.loading")}</p>;
  if (profile?.role !== "ADMIN") return null;
  return (
    <div>
      <div className="no-print">
        <h1>{t("admin.dashboard")}</h1>
        <Link href="/admin/settings">{t("admin.settings")}</Link>
        <p>
          {t("fix.household")}: {families ?? "—"} ·{" "}
          {t("admin.newFamilies")}: {recent ?? "—"}
        </p>
        <label>
          {t("admin.selectBatch")}
          <select
            className="input"
            value={batchId ?? ""}
            disabled={busy}
            onChange={(e) => setBatch(e.target.value)}
          >
            <option value="*">{t("fix.all")}</option>
            {batches.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          {t("fix.scope")}:{" "}
          {batchId === "*"
            ? t("fix.all")
            : batches.find((b) => b.id === batchId)?.name}{" "}
          · {orders.length}
        </p>
        {error && (
          <p role="alert">
            {t("fix.adminError")}{" "}
            <button onClick={() => setRetry((n) => n + 1)}>
              {t("fix.retry")}
            </button>
          </p>
        )}
        <button
          className="btn btn-primary"
          disabled={busy || error || !orders.length}
          onClick={() => print(orders)}
        >
          {t("fix.print")}
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy || error || !selected.size}
          onClick={() => print(orders.filter((o) => selected.has(o.id)))}
        >
          {t("fix.printSelected")} ({selected.size})
        </button>
        {busy && <p>{t("common.loading")}</p>}
        {!busy && !error && !orders.length && <p>{t("admin.noOrdersFound")}</p>}
        <div className="overflow-x-auto">
          <table className="admin-orders-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={t("fix.printSelected")}
                    checked={
                      orders.length > 0 && selected.size === orders.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(orders.map((o) => o.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th>{t("fix.household")}</th>
                <th>{t("register.phone")}</th>
                <th>{t("fix.pickup")}</th>
                <th>{t("fix.dry")}</th>
                <th>{t("fix.fresh")}</th>
                <th>{t("fix.order")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={order.userName}
                      checked={selected.has(order.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(order.id);
                          else next.delete(order.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    <strong>{order.userName}</strong>
                    <p>{order.userEmail}</p>
                    <details>
                      <summary>{t("fix.details")}</summary>
                      <FulfillmentDetails order={order} t={t} />
                      <ul>
                        {(
                          order.selectedItems ?? [
                            ...(order.dryGoodsItems ?? []),
                            ...(order.freshGoodsItems ?? []),
                          ]
                        ).map((k) => (
                          <li key={k}>{t(`request.items.${k}`)}</li>
                        ))}
                      </ul>
                      <p>{order.otherItems || order.items}</p>
                    </details>
                  </td>
                  <td>{order.userPhone || t("fix.notRecorded")}</td>
                  <td>{formatPickupDate(order.pickupDate, language)}</td>
                  {(["dryGoods", "freshGoods"] as const).map((kind) => (
                    <td key={kind}>
                      <label>
                        <input
                          type="checkbox"
                          disabled={updating === order.id}
                          checked={order.packingStatus?.[kind] === "PACKED"}
                          onChange={(e) =>
                            void packing(order, kind, e.target.checked)
                          }
                        />{" "}
                        {t("fix.packed")}
                      </label>
                    </td>
                  ))}
                  <td>
                    <button
                      disabled={busy || error}
                      onClick={() => print([order])}
                    >
                      {t("fix.printSelected")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {more && (
          <button disabled={busy || error} onClick={() => void next()}>
            {t("fix.more")}
          </button>
        )}
      </div>
      <div ref={printRef}>
        <PrintLayout orders={printing} t={t} language={language} />
      </div>
    </div>
  );
}
