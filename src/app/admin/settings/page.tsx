"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { startNewBatch } from "@/lib/batchUtils";

export default function AdminSettings() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { t } = useLanguage();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [scheduledOpen, setScheduledOpen] = useState("");
    const [scheduledClose, setScheduledClose] = useState("");
    const [nextPickupDate, setNextPickupDate] = useState("");
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
                setNextPickupDate(data.nextPickupDate || "");
            }
        } catch (err) {
            console.error("Error fetching settings:", err);
        }
        setLoadingSettings(false);
    };

    const handleSave = async () => {
        // Validation: Check if scheduling open but no pickup date
        if (scheduledOpen && !nextPickupDate) {
            const confirmed = window.confirm(t("settings.pickupDateWarning"));
            if (!confirmed) {
                return;
            }
        }

        setSaving(true);
        setMessage("");
        try {
            // Check if a new scheduled open time is being set
            const docRef = doc(db, "settings", "global");
            const docSnap = await getDoc(docRef);
            const currentScheduledOpen = docSnap.exists() ? docSnap.data().scheduledOpen : "";

            if (scheduledOpen && scheduledOpen !== currentScheduledOpen) {
                // Start a new batch for the new schedule
                await startNewBatch("SCHEDULED", scheduledOpen);
            }

            await setDoc(doc(db, "settings", "global"), {
                isFormOpen,
                scheduledOpen,
                scheduledClose,
                nextPickupDate
            }, { merge: true });
            setMessage(t("settings.savedSuccess"));
        } catch (err) {
            console.error("Error saving settings:", err);
            setMessage(t("settings.saveError"));
        }
        setSaving(false);
    };

    const handleManualToggle = async () => {
        const newState = !isFormOpen;
        setIsFormOpen(newState);

        if (newState) {
            // If opening manually, start a new batch
            try {
                await startNewBatch("MANUAL", new Date().toISOString());
            } catch (err) {
                console.error("Error starting batch on manual open:", err);
                // Continue to save state even if batch fails? Probably better to alert.
                alert("Error starting new batch. Please try again.");
                return;
            }
        }

        // We need to save this state immediately as per previous logic, or just let the user click save?
        // The previous logic didn't save on toggle, it just updated local state. 
        // BUT, the toggle button implies immediate action usually. 
        // Looking at previous code, it just updated state `setIsFormOpen(!isFormOpen)`.
        // So the user had to click "Save All Settings".
        // However, for "Open Form Manually" to be effective immediately, it usually implies a save.
        // Let's keep it as local state update to be consistent with "Save All Settings" button,
        // BUT `startNewBatch` writes to DB immediately. This is a bit inconsistent.
        // If I start a batch but don't save "isFormOpen: true", then we have a batch but closed form.
        // Ideally, "Open Form Manually" should probably be an immediate action.
        // Let's make the toggle button save immediately for better UX and consistency with batch creation.

        try {
            await setDoc(doc(db, "settings", "global"), {
                isFormOpen: newState
            }, { merge: true });
            setMessage(t("settings.savedSuccess"));
        } catch (err) {
            console.error("Error saving manual toggle:", err);
            setMessage(t("settings.saveError"));
        }
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

                            {/* Next Pick-up Date */}
                            <div>
                                <label className="label">{t("settings.nextPickupDate")}</label>
                                <input
                                    type="date"
                                    className="input"
                                    value={nextPickupDate}
                                    onChange={(e) => setNextPickupDate(e.target.value)}
                                />
                            </div>

                            <button
                                onClick={() => { setScheduledOpen(""); setScheduledClose(""); setNextPickupDate(""); }}
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
