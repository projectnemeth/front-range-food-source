"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc, addDoc, collection, onSnapshot, query, where, getDocs } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

export default function RequestPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { t } = useLanguage();

    const [isFormOpen, setIsFormOpen] = useState<boolean | null>(null);
    const [scheduleMessage, setScheduleMessage] = useState("");
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [items, setItems] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");
    const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
    const [hasOrdered, setHasOrdered] = useState(false);

    // Check if form is open (Real-time listener)
    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, "settings", "global"), (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                const manualOpen = data.isFormOpen;
                const scheduledOpen = data.scheduledOpen;
                const scheduledClose = data.scheduledClose;
                setCurrentBatchId(data.currentBatchId || null);

                // Determine if open based on schedule or manual override
                let open = manualOpen;
                let msg = "";

                if (scheduledOpen && scheduledClose) {
                    const now = new Date();
                    const openDate = new Date(scheduledOpen);
                    const closeDate = new Date(scheduledClose);

                    if (now < openDate) {
                        open = false;
                        msg = `${t("request.formOpensOn")} ${openDate.toLocaleString()}`;
                    } else if (now > closeDate) {
                        open = false;
                        msg = `${t("request.formClosedOn")} ${closeDate.toLocaleString()}`;
                    } else {
                        open = true;
                        msg = `${t("request.formClosesOn")} ${closeDate.toLocaleString()}`;
                    }
                }

                setIsFormOpen(open);
                setScheduleMessage(msg);
            } else {
                setIsFormOpen(false);
            }
            setLoadingSettings(false);
        });

        return () => unsubscribe();
    }, [t]);

    // Check if user has already ordered in this batch
    useEffect(() => {
        const checkOrder = async () => {
            if (user && currentBatchId) {
                try {
                    const q = query(
                        collection(db, "orders"),
                        where("userId", "==", user.uid),
                        where("batchId", "==", currentBatchId)
                    );
                    const snapshot = await getDocs(q);
                    if (!snapshot.empty) {
                        setHasOrdered(true);
                    } else {
                        setHasOrdered(false);
                    }
                } catch (err) {
                    console.error("Error checking existing orders:", err);
                }
            }
        };
        checkOrder();
    }, [user, currentBatchId]);

    // Redirect if not logged in
    useEffect(() => {
        if (!authLoading && !user) {
            router.push("/login");
        }
    }, [authLoading, user, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        if (hasOrdered) {
            setMessage(t("request.alreadyOrdered"));
            return;
        }

        setSubmitting(true);
        try {
            await addDoc(collection(db, "orders"), {
                userId: user.uid,
                userEmail: user.email,
                userName: user.displayName,
                items: items,
                status: "PENDING",
                createdAt: new Date().toISOString(),
                batchId: currentBatchId // Add batch ID
            });
            setMessage(t("request.successMessage"));
            setItems("");
            setHasOrdered(true); // Prevent immediate re-submission
        } catch (err) {
            console.error(err);
            setMessage(t("request.errorMessage"));
        }
        setSubmitting(false);
    };

    if (authLoading || loadingSettings) return <div className="text-center mt-md">{t("common.loading")}</div>;

    if (!isFormOpen) {
        return (
            <div className="flex justify-center">
                <div className="card text-center" style={{ maxWidth: "500px" }}>
                    <h2 className="text-xl font-bold mb-md" style={{ color: "var(--color-secondary)" }}>{t("request.closedTitle")}</h2>
                    <p>{t("request.closedMessage")}</p>
                    {scheduleMessage && <p className="text-sm text-muted mt-sm">{scheduleMessage}</p>}
                    <button onClick={() => router.push("/")} className="btn btn-secondary mt-md">{t("common.backToHome")}</button>
                </div>
            </div>
        );
    }

    if (hasOrdered) {
        return (
            <div className="flex justify-center">
                <div className="card text-center" style={{ maxWidth: "500px" }}>
                    <h2 className="text-xl font-bold mb-md text-green-700">{t("request.successMessage")}</h2>
                    <p>{t("request.alreadyOrdered")}</p>
                    <button onClick={() => router.push("/")} className="btn btn-secondary mt-md">{t("common.backToHome")}</button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-center">
            <div className="card" style={{ width: "100%", maxWidth: "600px" }}>
                <h1 className="text-2xl font-bold mb-md text-center">{t("request.title")}</h1>

                {scheduleMessage && <div className="text-center text-sm text-muted mb-md">{scheduleMessage}</div>}

                {message && (
                    <div className={`p-md mb-md rounded ${message.includes(t("common.error")) ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`} style={{ backgroundColor: message.includes(t("common.error")) ? "#FEE2E2" : "#D1FAE5", color: message.includes(t("common.error")) ? "#991B1B" : "#065F46" }}>
                        {message}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col gap-md">
                    <div>
                        <label className="label">{t("request.itemsLabel")}</label>
                        <textarea
                            className="input"
                            rows={5}
                            value={items}
                            onChange={(e) => setItems(e.target.value)}
                            placeholder={t("request.itemsPlaceholder")}
                            required
                        />
                    </div>

                    <div className="flex gap-md">
                        <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
                            {submitting ? t("request.submitting") : t("request.submitButton")}
                        </button>
                        <button type="button" onClick={() => router.push("/")} className="btn btn-secondary">
                            {t("common.cancel")}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
