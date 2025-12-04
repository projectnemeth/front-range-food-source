"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";

const COLORADO_COUNTIES = [
    "Adams", "Alamosa", "Arapahoe", "Archuleta", "Baca", "Bent", "Boulder", "Broomfield", "Chaffee", "Cheyenne",
    "Clear Creek", "Conejos", "Costilla", "Crowley", "Custer", "Delta", "Denver", "Dolores", "Douglas", "Eagle",
    "Elbert", "El Paso", "Fremont", "Garfield", "Gilpin", "Grand", "Gunnison", "Hinsdale", "Huerfano", "Jackson",
    "Jefferson", "Kiowa", "Kit Carson", "Lake", "La Plata", "Larimer", "Las Animas", "Lincoln", "Logan", "Mesa",
    "Mineral", "Moffat", "Montezuma", "Montrose", "Morgan", "Otero", "Ouray", "Park", "Phillips", "Pitkin",
    "Prowers", "Pueblo", "Rio Blanco", "Rio Grande", "Routt", "Saguache", "San Juan", "San Miguel", "Sedgwick",
    "Summit", "Teller", "Washington", "Weld", "Yuma"
];

export default function RegisterPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [foodBankId, setFoodBankId] = useState("");
    const [county, setCounty] = useState("");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [adults, setAdults] = useState(1);
    const [children, setChildren] = useState(0);
    const [seniors, setSeniors] = useState(0);
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const generateFamilyId = () => {
        // Simple random ID generation: FAM-XXXX
        const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `FAM-${randomStr}`;
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            const fullName = `${firstName} ${lastName}`;

            // Update profile with name
            await updateProfile(user, { displayName: fullName });

            // Use provided Food Bank ID or generate one
            const finalFamilyId = foodBankId.trim() ? foodBankId.trim() : generateFamilyId();

            // Create user document in Firestore
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                email: user.email,
                firstName: firstName,
                lastName: lastName,
                name: fullName, // Keep full name for easier display
                address: address,
                county: county,
                phone: phone,
                familySize: {
                    adults: Number(adults),
                    children: Number(children),
                    seniors: Number(seniors),
                    total: Number(adults) + Number(children) + Number(seniors)
                },
                familyId: finalFamilyId,
                role: "USER", // Default role
                createdAt: new Date().toISOString(),
            });

            router.push("/");
        } catch (err: any) {
            setError(err.message || "Failed to register.");
            console.error(err);
        }
        setSubmitting(false);
    };

    return (
        <div className="flex justify-center items-center py-md" style={{ minHeight: "60vh" }}>
            <div className="card" style={{ width: "100%", maxWidth: "500px" }}>
                <h1 className="text-xl text-center mb-md">Register Family</h1>
                {error && <div className="text-center mb-md" style={{ color: "var(--color-error)" }}>{error}</div>}
                <form onSubmit={handleRegister} className="flex flex-col gap-md">
                    <div className="grid grid-cols-2 gap-md">
                        <div>
                            <label className="label">First Name</label>
                            <input
                                type="text"
                                className="input"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="label">Last Name</label>
                            <input
                                type="text"
                                className="input"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                required
                            />
                        </div>
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
                            minLength={6}
                        />
                    </div>

                    <div>
                        <label className="label">Address</label>
                        <input
                            type="text"
                            className="input"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            required
                            placeholder="123 Main St, City, Zip"
                        />
                    </div>

                    <div>
                        <label className="label">Which county do you live in?</label>
                        <select
                            className="input"
                            value={county}
                            onChange={(e) => setCounty(e.target.value)}
                            required
                        >
                            <option value="">Select a county...</option>
                            {COLORADO_COUNTIES.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="label">Phone Number</label>
                        <input
                            type="tel"
                            className="input"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required
                            placeholder="(555) 123-4567"
                        />
                    </div>

                    <div>
                        <label className="label">Food Bank ID <span className="text-sm font-normal text-muted">(Optional)</span></label>
                        <input
                            type="text"
                            className="input"
                            value={foodBankId}
                            onChange={(e) => setFoodBankId(e.target.value)}
                            placeholder="If you have one, enter it here"
                        />
                        <p className="text-xs text-muted mt-xs">If you do not have one, one will be assigned to you.</p>
                    </div>

                    <div className="grid grid-cols-3 gap-sm">
                        <div>
                            <label className="label text-sm">Adults (18-59)</label>
                            <input
                                type="number"
                                className="input"
                                value={adults}
                                onChange={(e) => setAdults(Number(e.target.value))}
                                min={1}
                                required
                            />
                        </div>
                        <div>
                            <label className="label text-sm">Children (0-17)</label>
                            <input
                                type="number"
                                className="input"
                                value={children}
                                onChange={(e) => setChildren(Number(e.target.value))}
                                min={0}
                                required
                            />
                        </div>
                        <div>
                            <label className="label text-sm">Seniors (60+)</label>
                            <input
                                type="number"
                                className="input"
                                value={seniors}
                                onChange={(e) => setSeniors(Number(e.target.value))}
                                min={0}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? "Registering..." : "Register"}
                    </button>
                </form>
                <div className="text-center mt-md text-sm">
                    Already have an account? <Link href="/login" style={{ color: "var(--color-primary)" }}>Login here</Link>
                </div>
            </div>
        </div>
    );
}
