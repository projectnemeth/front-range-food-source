"use client";

import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        setError("");
        setSubmitting(true);

        try {
            await sendPasswordResetEmail(auth, email);
            setMessage("Password reset email sent! Check your inbox.");
        } catch (err: any) {
            console.error(err);
            if (err.code === 'auth/user-not-found') {
                setError("No account found with this email.");
            } else {
                setError("Failed to send reset email. Please try again.");
            }
        }
        setSubmitting(false);
    };

    return (
        <div className="flex justify-center items-center" style={{ minHeight: "60vh" }}>
            <div className="card" style={{ width: "100%", maxWidth: "400px" }}>
                <h1 className="text-xl text-center mb-md">Reset Password</h1>

                {message && <div className="text-center mb-md" style={{ color: "var(--color-success)" }}>{message}</div>}
                {error && <div className="text-center mb-md" style={{ color: "var(--color-error)" }}>{error}</div>}

                <form onSubmit={handleReset} className="flex flex-col gap-md">
                    <div>
                        <label className="label">Email Address</label>
                        <input
                            type="email"
                            className="input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="Enter your registered email"
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? "Sending..." : "Send Reset Link"}
                    </button>
                </form>

                <div className="text-center mt-md text-sm">
                    <Link href="/login" style={{ color: "var(--color-primary)" }}>Back to Login</Link>
                </div>
            </div>
        </div>
    );
}
