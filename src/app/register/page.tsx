"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const router = useRouter();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Update profile with name
            await updateProfile(user, { displayName: name });

            // Create user document in Firestore
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                email: user.email,
                name: name,
                role: "USER", // Default role
                createdAt: new Date().toISOString(),
            });

            router.push("/");
        } catch (err: any) {
            setError(err.message || "Failed to register.");
            console.error(err);
        }
    };

    return (
        <div className="flex justify-center items-center" style={{ minHeight: "60vh" }}>
            <div className="card" style={{ width: "100%", maxWidth: "400px" }}>
                <h1 className="text-xl text-center mb-md">Register</h1>
                {error && <div className="text-center mb-md" style={{ color: "var(--color-error)" }}>{error}</div>}
                <form onSubmit={handleRegister} className="flex flex-col gap-md">
                    <div>
                        <label className="label">Full Name</label>
                        <input
                            type="text"
                            className="input"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="label">Email</label>
                        <input
                            type="email"
                            className="input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="label">Password</label>
                        <input
                            type="password"
                            className="input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="btn btn-primary">Register</button>
                </form>
                <div className="text-center mt-md text-sm">
                    Already have an account? <Link href="/login" style={{ color: "var(--color-primary)" }}>Login here</Link>
                </div>
            </div>
        </div>
    );
}
