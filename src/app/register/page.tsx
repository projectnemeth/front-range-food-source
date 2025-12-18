"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { validateRegistrationData } from "./actions";
import { useLanguage } from "@/context/LanguageContext";

// List of Colorado Counties
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
    const router = useRouter();
    const { t } = useLanguage();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [county, setCounty] = useState("");
    const [foodBankId, setFoodBankId] = useState("");
    const [adults, setAdults] = useState(1);
    const [children, setChildren] = useState(0);
    const [seniors, setSeniors] = useState(0);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            console.log('Attempting server-side validation...');
            // 1. Validate duplicates on the SERVER (Admin permissions)
            const validation = await validateRegistrationData({
                firstName,
                lastName,
                address,
                phone,
                foodBankId: foodBankId || undefined
            });

            console.log('Validation response:', validation);

            if (validation.error) {
                throw new Error(validation.error);
            }

            // 2. Create User in Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Update profile
            await updateProfile(user, { displayName: `${firstName} ${lastName}` });

            // 3. Generate Family ID (if not provided)
            const finalFoodBankId = foodBankId || `FB-${Date.now().toString().slice(-6)}`;

            // 4. Store additional details in Firestore (User only has permission to write their OWN doc)
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                email: user.email,
                firstName,
                lastName,
                displayName: `${firstName} ${lastName}`,
                address,
                phone,
                county,
                foodBankId: finalFoodBankId,
                familySize: {
                    adults,
                    children,
                    seniors,
                    total: Number(adults) + Number(children) + Number(seniors)
                },
                role: "USER",
                createdAt: new Date().toISOString()
            });

            router.push("/");
        } catch (err: any) {
            console.error("Registration error:", err);

            let errorMsg = t("register.failed");
            const loginResetMsg = ` ${t("register.loginOrReset")}`;

            if (err.message === "duplicatePhone") {
                errorMsg = t("register.duplicatePhone") + loginResetMsg;
            } else if (err.message === "duplicateAddress") {
                errorMsg = t("register.duplicateAddress") + loginResetMsg;
            } else if (err.message === "duplicateFoodBankId") {
                errorMsg = t("register.duplicateFoodBankId") + loginResetMsg;
            } else if (err.message === "duplicateName") {
                errorMsg = t("register.duplicateName") + loginResetMsg;
            } else if (err.code === "auth/email-already-in-use") {
                errorMsg = t("register.duplicateEmail") + loginResetMsg;
            } else if (err.message) {
                // Fallback for other errors
                errorMsg = err.message;
            }

            setError(errorMsg);
        }
        setLoading(false);
    };

    return (
        <div className="flex justify-center">
            <div className="card" style={{ width: "100%", maxWidth: "500px" }}>
                <h1 className="text-2xl font-bold mb-md text-center">{t("register.title")}</h1>
                {error && <div className="bg-red-100 text-red-700 p-sm rounded mb-md text-sm">{error}</div>}
                <form onSubmit={handleRegister} className="flex flex-col gap-md">

                    <div className="flex gap-md">
                        <div className="flex-1">
                            <label className="label">{t("register.firstName")}</label>
                            <input
                                type="text"
                                className="input"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex-1">
                            <label className="label">{t("register.lastName")}</label>
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

                    <div>
                        <label className="label">{t("register.address")}</label>
                        <input
                            type="text"
                            className="input"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label className="label">{t("register.phone")}</label>
                        <input
                            type="tel"
                            className="input"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label className="label">{t("register.county")}</label>
                        <select
                            className="input"
                            value={county}
                            onChange={(e) => setCounty(e.target.value)}
                            required
                        >
                            <option value="">{t("register.selectCounty")}</option>
                            {COLORADO_COUNTIES.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="label">{t("register.foodBankId")} <span className="text-muted font-normal">{t("register.optional")}</span></label>
                        <input
                            type="text"
                            className="input"
                            value={foodBankId}
                            onChange={(e) => setFoodBankId(e.target.value)}
                            placeholder={t("register.foodBankIdPlaceholder")}
                        />
                        <p className="text-xs text-muted mt-xs">{t("register.foodBankIdHelp")}</p>
                    </div>

                    <div className="flex gap-md">
                        <div className="flex-1">
                            <label className="label">{t("register.adults")}</label>
                            <input
                                type="number"
                                min="1"
                                className="input"
                                value={adults}
                                onChange={(e) => setAdults(parseInt(e.target.value))}
                                required
                            />
                        </div>
                        <div className="flex-1">
                            <label className="label">{t("register.children")}</label>
                            <input
                                type="number"
                                min="0"
                                className="input"
                                value={children}
                                onChange={(e) => setChildren(parseInt(e.target.value))}
                                required
                            />
                        </div>
                        <div className="flex-1">
                            <label className="label">{t("register.seniors")}</label>
                            <input
                                type="number"
                                min="0"
                                className="input"
                                value={seniors}
                                onChange={(e) => setSeniors(parseInt(e.target.value))}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? t("register.registering") : t("common.register")}
                    </button>
                </form>
                <p className="text-center mt-md text-sm">
                    {t("register.alreadyHaveAccount")} <Link href="/login" className="text-blue-600 hover:underline">{t("register.loginHere")}</Link>
                </p>
            </div>
        </div>
    );
}
