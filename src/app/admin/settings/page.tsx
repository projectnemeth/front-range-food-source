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
    const [isFormOpen, setIsFormOpen] = useState<boolean | null>(null);
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
                setIsFormOpen(data.isFormOpen !== undefined ? data.isFormOpen : null);
                setScheduledOpen(data.scheduledOpen || "");
                setScheduledClose(data.scheduledClose || "");
                setNextPickupDate(data.nextPickupDate || "");
            }
        } catch (err) {
            console.error("Error fetching settings:", err);
        } finally {
            setLoadingSettings(false);
        }
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

    const handleManualToggleAction = async (newState: boolean | null) => {
        setIsFormOpen(newState);

        if (newState === true) {
            try {
                await startNewBatch("MANUAL", new Date().toISOString());
            } catch (err) {
                console.error("Error starting batch on manual open:", err);
                alert("Error starting new batch. Please try again.");
                return;
            }
        }

        try {
            await setDoc(doc(db, "settings", "global"), {
                isFormOpen: newState === null ? null : newState
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
                        <div className="flex flex-col gap-sm">
                            <div className="flex items-center justify-between">
                                <span>{t("settings.currentStatus")}:</span>
                                <span className={`font-bold ${isFormOpen === true ? "text-green-600" : isFormOpen === false ? "text-red-600" : "text-blue-600"}`}>
                                    {isFormOpen === true ? t("settings.open") : isFormOpen === false ? t("settings.closed") : t("settings.scheduledMode")}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-sm">
                                <button
                                    onClick={() => handleManualToggleAction(true)}
                                    className={`btn ${isFormOpen === true ? "btn-secondary" : "btn-primary"}`}
                                >
                                    {t("settings.openManually")}
                                </button>
                                <button
                                    onClick={() => handleManualToggleAction(false)}
                                    className={`btn ${isFormOpen === false ? "btn-secondary" : "btn-primary"}`}
                                >
                                    {t("settings.closeManually")}
                                </button>
                            </div>

                            {isFormOpen !== null && (
                                <button
                                    onClick={() => handleManualToggleAction(null)}
                                    className="btn btn-outline w-full"
                                    style={{ border: "1px solid var(--color-primary)", color: "var(--color-primary)", background: "transparent" }}
                                >
                                    {t("settings.returnToSchedule")}
                                </button>
                            )}
                        </div>
                        <p className="text-xs text-muted mt-xs">
                            {isFormOpen === null ? t("settings.note") : t("settings.manualOverrideActive")}
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
