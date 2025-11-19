"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import Link from "next/link";

export default function AdminSettings() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const [isFormOpen, setIsFormOpen] = useState(false);
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
                setIsFormOpen(docSnap.data().isFormOpen);
            }
        } catch (err) {
            console.error("Error fetching settings:", err);
        }
        setLoadingSettings(false);
    };

    const handleToggle = async () => {
        setSaving(true);
        setMessage("");
        try {
            const newState = !isFormOpen;
            await setDoc(doc(db, "settings", "global"), { isFormOpen: newState }, { merge: true });
            setIsFormOpen(newState);
            setMessage(`Form is now ${newState ? "OPEN" : "CLOSED"}`);
        } catch (err) {
            console.error("Error saving settings:", err);
            setMessage("Error saving settings.");
        }
        setSaving(false);
    };

    if (loading || loadingSettings) return <div className="text-center mt-md">Loading...</div>;

    if (profile?.role !== "ADMIN") return null;

    return (
        <div className="flex justify-center">
            <div className="card" style={{ width: "100%", maxWidth: "500px" }}>
                <h1 className="text-xl font-bold mb-md text-center">Admin Settings</h1>

                <div className="flex flex-col gap-md items-center">
                    <div className="text-center">
                        <p className="mb-sm">Current Status:</p>
                        <div className={`text-2xl font-bold ${isFormOpen ? "text-green-600" : "text-red-600"}`} style={{ color: isFormOpen ? "var(--color-success)" : "var(--color-error)" }}>
                            {isFormOpen ? "OPEN" : "CLOSED"}
                        </div>
                    </div>

                    <button
                        onClick={handleToggle}
                        className={`btn ${isFormOpen ? "btn-secondary" : "btn-primary"}`}
                        disabled={saving}
                    >
                        {saving ? "Saving..." : (isFormOpen ? "Close Form" : "Open Form")}
                    </button>

                    {message && <p className="text-sm mt-sm">{message}</p>}

                    <Link href="/admin" className="text-sm text-muted mt-md underline">
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
