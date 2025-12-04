"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";

export default function AdminSettings() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { t } = useLanguage();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [scheduledOpen, setScheduledOpen] = useState("");
    const [scheduledClose, setScheduledClose] = useState("");
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!loading) {
            if (!user || profile?.role !== "ADMIN") {
                router.push("/");
            } else {
                fetchSettings();
            }
        }
    }, [user, profile, loading, router]);

    const fetchSettings = async () => {
        try {
            const docRef = doc(db, "settings", "global");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setIsFormOpen(data.isFormOpen);
                setScheduledOpen(data.scheduledOpen || "");
                setScheduledClose(data.scheduledClose || "");
            }
        } catch (err) {
            console.error("Error fetching settings:", err);
        }
        setLoadingSettings(false);
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage("");
        try {
            await setDoc(doc(db, "settings", "global"), {
                isFormOpen,
                scheduledOpen,
                scheduledClose
            }, { merge: true });
            setMessage(t("settings.savedSuccess"));
        } catch (err) {
            console.error("Error saving settings:", err);
            setMessage(t("settings.saveError"));
        }
        setSaving(false);
    };

    const handleManualToggle = () => {
        setIsFormOpen(!isFormOpen);
    };

    if (loading || loadingSettings) return <div className="text-center mt-md">{t("common.loading")}</div>;

    if (profile?.role !== "ADMIN") return null;

    return (
        <div className="flex justify-center">
            <div className="card" style={{ width: "100%", maxWidth: "500px" }}>
                <h1 className="text-xl font-bold mb-md text-center">{t("settings.title")}</h1>

                <div className="flex flex-col gap-md">

                    {/* Manual Toggle Section */}
                    <div className="border-b pb-md">
                        <h3 className="font-bold mb-sm">{t("settings.manualControl")}</h3>
                        <div className="flex items-center justify-between">
                            <span>{t("settings.currentStatus")}:</span>
                            <span className={`font-bold ${isFormOpen ? "text-green-600" : "text-red-600"}`} style={{ color: isFormOpen ? "var(--color-success)" : "var(--color-error)" }}>
                                {isFormOpen ? t("settings.open") : t("settings.closed")}
                            </span>
                        </div>
                        <button
                            onClick={handleManualToggle}
                            className={`btn mt-sm w-full ${isFormOpen ? "btn-secondary" : "btn-primary"}`}
                        >
                            {isFormOpen ? t("settings.closeManually") : t("settings.openManually")}
                        </button>
                        <p className="text-xs text-muted mt-xs">
                            {t("settings.note")}
                        </p>
                    </div>

                    {/* Scheduling Section */}
                    <div>
                        <h3 className="font-bold mb-sm">{t("settings.scheduledAvailability")}</h3>
                        <div className="flex flex-col gap-sm">
                            <div>
                                <label className="label">{t("settings.opensAt")}</label>
                                <input
                                    type="datetime-local"
                                    className="input"
                                    value={scheduledOpen}
                                    onChange={(e) => setScheduledOpen(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="label">{t("settings.closesAt")}</label>
                                <input
                                    type="datetime-local"
                                    className="input"
                                    value={scheduledClose}
                                    onChange={(e) => setScheduledClose(e.target.value)}
                                />
                            </div>
                            <button
                                onClick={() => { setScheduledOpen(""); setScheduledClose(""); }}
                                className="text-sm text-red-600 underline text-left"
                            >
                                {t("settings.clearSchedule")}
                            </button>
                        </div>
                    </div>

                    <div className="mt-md">
                        <button
                            onClick={handleSave}
                            className="btn btn-primary w-full"
                            disabled={saving}
                        >
                            {saving ? t("settings.saving") : t("settings.save")}
                        </button>
                        {message && <p className="text-center text-sm mt-sm">{message}</p>}
                    </div>

                    <Link href="/admin" className="text-sm text-muted mt-sm text-center underline">
                        {t("common.backToDashboard")}
                    </Link>
                </div>
            </div>
        </div>
    );
}
