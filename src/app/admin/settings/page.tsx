"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client-api";
import { formatPickupDate } from "@/lib/dates";
import { message } from "@/lib/messages";
interface Batch {
  id: string;
  pickupDate: string;
  scheduledOpen: string;
  scheduledClose: string;
}
interface Settings {
  isFormOpen: boolean | null;
  activeBatch: Batch | null;
  pendingBatch: Batch | null;
}
export default function AdminSettings() {
  const { user, profile, loading, profileError, refreshProfile } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pickupDate, setPickupDate] = useState("");
  const [scheduledOpen, setOpen] = useState("");
  const [scheduledClose, setClose] = useState("");
  const [openOffset, setOpenOffset] = useState("");
  const [closeOffset, setCloseOffset] = useState("");
  const load = useCallback(async () => {
    try {
      setSettings(await api<Settings>("/api/admin/settings"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "serverError");
    }
  }, []);
  useEffect(() => {
    if (loading) return;
    if (!user || profile?.role !== "ADMIN") {
      if (!profileError) router.replace("/");
      return;
    }
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [loading, user, profile, profileError, router, load]);
  const save = async (body: unknown) => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await api("/api/admin/settings", body);
      await load();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "serverError");
    } finally {
      setSaving(false);
    }
  };
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
    <div className="card" style={{ maxWidth: 600, margin: "auto" }}>
      <h1>{t("settings.title")}</h1>
      {error && (
        <p role="alert">
          {message(language, error)}{" "}
          <button onClick={() => void load()}>{t("fix.retry")}</button>
        </p>
      )}
      {!settings && !error && <p>{t("common.loading")}</p>}
      {settings && (
        <>
          <h2>
            {t("fix.active")}:{" "}
            {settings.activeBatch
              ? formatPickupDate(settings.activeBatch.pickupDate, language)
              : t("fix.noBatch")}
          </h2>
          <p>
            {t("settings.currentStatus")}:{" "}
            {settings.isFormOpen === true
              ? t("settings.open")
              : settings.isFormOpen === false
                ? t("settings.closed")
                : t("settings.scheduledMode")}
          </p>
          <div className="flex gap-md">
            <button
              className="btn btn-primary"
              disabled={saving || !settings.activeBatch}
              onClick={() => void save({ action: "toggle", isFormOpen: true })}
            >
              {t("settings.openManually")}
            </button>
            <button
              className="btn btn-secondary"
              disabled={saving || !settings.activeBatch}
              onClick={() => void save({ action: "toggle", isFormOpen: false })}
            >
              {t("settings.closeManually")}
            </button>
          </div>
          <button
            className="btn btn-secondary mt-md"
            disabled={saving || !settings.activeBatch}
            onClick={() => void save({ action: "toggle", isFormOpen: null })}
          >
            {t("settings.returnToSchedule")}
          </button>
          {settings.pendingBatch && (
            <p>
              {t("fix.future")}:{" "}
              {formatPickupDate(settings.pendingBatch.pickupDate, language)}
            </p>
          )}
        </>
      )}
      <h2>{t("fix.create")}</h2>
      <p>{t("fix.createHelp")}</p>
      <p>{t("fix.zone")}</p>
      <form
        className="flex flex-col gap-md"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            action: "create",
            pickupDate,
            scheduledOpen,
            scheduledClose,
            ...(openOffset ? { openOffset } : {}),
            ...(closeOffset ? { closeOffset } : {}),
          });
        }}
      >
        <label>
          {t("fix.pickup")}
          <input
            type="date"
            className="input"
            required
            value={pickupDate}
            onChange={(e) => setPickupDate(e.target.value)}
          />
        </label>
        <label>
          {t("settings.opensAt")}
          <input
            type="datetime-local"
            className="input"
            value={scheduledOpen}
            onChange={(e) => setOpen(e.target.value)}
          />
        </label>
        <label>
          {t("settings.closesAt")}
          <input
            type="datetime-local"
            className="input"
            value={scheduledClose}
            onChange={(e) => setClose(e.target.value)}
          />
        </label>
        <label>
          {t("fix.openOffset")}
          <input
            className="input"
            placeholder="-06:00"
            pattern="[+-][0-9]{2}:[0-9]{2}"
            value={openOffset}
            onChange={(e) => setOpenOffset(e.target.value)}
          />
        </label>
        <label>
          {t("fix.closeOffset")}
          <input
            className="input"
            placeholder="-07:00"
            pattern="[+-][0-9]{2}:[0-9]{2}"
            value={closeOffset}
            onChange={(e) => setCloseOffset(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={saving || !settings}>
          {saving ? t("settings.saving") : t("fix.create")}
        </button>
      </form>
      {saved && <p role="status">{t("fix.saved")}</p>}
      <Link href="/admin">{t("common.backToDashboard")}</Link>
    </div>
  );
}
