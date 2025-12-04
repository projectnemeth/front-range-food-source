"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const router = useRouter();
    const { t } = useLanguage();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            await signInWithEmailAndPassword(auth, email, password);
            router.push("/"); // Redirect to home/dashboard after login
        } catch (err: any) {
            setError("Failed to login. Please check your credentials.");
            console.error(err);
        }
    };

    return (
        <div className="flex justify-center items-center" style={{ minHeight: "60vh" }}>
            <div className="card" style={{ width: "100%", maxWidth: "400px" }}>
                <h1 className="text-xl text-center mb-md">{t("common.login")}</h1>
                {error && <div className="text-center mb-md" style={{ color: "var(--color-error)" }}>{error}</div>}
                <form onSubmit={handleLogin} className="flex flex-col gap-md">
                    <div>
                        <label className="label">{t("common.email")}</label>
                        <input
                            type="email"
                            className="input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="label">{t("common.password")}</label>
                        <input
                            type="password"
                            className="input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="btn btn-primary">{t("common.login")}</button>
                </form>
                <div className="text-center mt-md text-sm flex flex-col gap-sm">
                    <Link href="/forgot-password" style={{ color: "var(--color-text-muted)" }}>{t("home.forgotPassword")}</Link>
                    <div>
                        {t("home.noAccount")} <Link href="/register" style={{ color: "var(--color-primary)" }}>{t("home.registerHere")}</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
