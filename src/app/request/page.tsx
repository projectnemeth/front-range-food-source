"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc, addDoc, collection, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";

export default function RequestPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    const [isFormOpen, setIsFormOpen] = useState<boolean | null>(null);
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [items, setItems] = useState("");
    const [scheduledDate, setScheduledDate] = useState("");
    const [scheduledTime, setScheduledTime] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");

    // Check if form is open (Real-time listener)
    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, "settings", "global"), (doc) => {
            if (doc.exists()) {
                setIsFormOpen(doc.data().isFormOpen);
            } else {
                // Default to closed if setting doesn't exist, or maybe open? 
                // Let's default to CLOSED for safety, admin must open it.
                setIsFormOpen(false);
            }
            setLoadingSettings(false);
        });

        return () => unsubscribe();
    }, []);

    // Redirect if not logged in
    useEffect(() => {
        if (!authLoading && !user) {
            router.push("/login");
        }
    }, [authLoading, user, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setSubmitting(true);
        try {
            await addDoc(collection(db, "orders"), {
                userId: user.uid,
                userEmail: user.email,
                userName: user.displayName,
                items: items, // In a real app, this might be a structured list
                scheduledDate: scheduledDate,
                scheduledTime: scheduledTime,
                status: "PENDING",
                createdAt: new Date().toISOString(),
            });
            setMessage("Request submitted successfully!");
            setItems("");
            setScheduledDate("");
            setScheduledTime("");
        } catch (err) {
            console.error(err);
            setMessage("Error submitting request.");
        }
        setSubmitting(false);
    };

    if (authLoading || loadingSettings) return <div className="text-center mt-md">Loading...</div>;

    if (!isFormOpen) {
        return (
            <div className="flex justify-center">
                <div className="card text-center" style={{ maxWidth: "500px" }}>
                    <h2 className="text-xl font-bold mb-md" style={{ color: "var(--color-secondary)" }}>Form Closed</h2>
                    <p>The food request form is currently closed. Please check back later.</p>
                    <button onClick={() => router.push("/")} className="btn btn-secondary mt-md">Back to Home</button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-center">
            <div className="card" style={{ width: "100%", maxWidth: "600px" }}>
                <h1 className="text-2xl font-bold mb-md text-center">Food Request Form</h1>

                {message && (
                    <div className={`p-md mb-md rounded ${message.includes("Error") ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`} style={{ backgroundColor: message.includes("Error") ? "#FEE2E2" : "#D1FAE5", color: message.includes("Error") ? "#991B1B" : "#065F46" }}>
                        {message}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col gap-md">
                    <div>
                        <label className="label">What items do you need?</label>
                        <textarea
                            className="input"
                            rows={5}
                            value={items}
                            onChange={(e) => setItems(e.target.value)}
                            placeholder="List the food items you are requesting..."
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-md">
                        <div>
                            <label className="label">Pickup Date</label>
                            <input
                                type="date"
                                className="input"
                                value={scheduledDate}
                                onChange={(e) => setScheduledDate(e.target.value)}
                                required
                                min={new Date().toISOString().split('T')[0]}
                            />
                        </div>
                        <div>
                            <label className="label">Preferred Time</label>
                            <select
                                className="input"
                                value={scheduledTime}
                                onChange={(e) => setScheduledTime(e.target.value)}
                                required
                            >
                                <option value="">Select a time...</option>
                                <option value="Morning (9AM - 12PM)">Morning (9AM - 12PM)</option>
                                <option value="Afternoon (1PM - 4PM)">Afternoon (1PM - 4PM)</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex gap-md">
                        <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
                            {submitting ? "Submitting..." : "Submit Request"}
                        </button>
                        <button type="button" onClick={() => router.push("/")} className="btn btn-secondary">
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
