"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";

import { COLORADO_COUNTIES } from "@/lib/counties";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/client-api";
import { message } from "@/lib/messages";
import { useLanguage } from "@/context/LanguageContext";

// List of Colorado Counties

export default function RegisterPage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const {
    user: signedInUser,
    profile,
    loading: authLoading,
    profileError,
    refreshProfile,
  } = useAuth();
  useEffect(() => {
    if (!authLoading && profile) router.replace("/");
  }, [authLoading, profile, router]);
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
      const user =
        auth.currentUser ??
        (await createUserWithEmailAndPassword(auth, email, password)).user;
      // 2. Update profile
      await updateProfile(user, { displayName: `${firstName} ${lastName}` });

      await api("/api/finalize-registration", {
        firstName,
        lastName,
        address,
        phone,
        county,
        foodBankId,
        familySize: { adults, children, seniors },
      });
      await refreshProfile();
      router.push("/");
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err && "code" in err ? String(err.code) : "";
      setError(
        code === "auth/email-already-in-use"
          ? t("register.duplicateEmail")
          : code === "auth/invalid-email"
            ? t("register.invalidEmail")
            : code === "auth/weak-password"
              ? t("register.weakPassword")
              : message(
                  language,
                  err instanceof Error ? err.message : "serverError",
                ),
      );
    }
    setLoading(false);
  };

  if (authLoading) return <p>{t("common.loading")}</p>;
  if (profileError)
    return (
      <div>
        {t("fix.profileError")}{" "}
        <button onClick={() => void refreshProfile()}>{t("fix.retry")}</button>
      </div>
    );
  return (
    <div className="flex justify-center">
      <div className="card" style={{ width: "100%", maxWidth: "500px" }}>
        <h1 className="text-2xl font-bold mb-md text-center">
          {t("register.title")}
        </h1>
        {error && (
          <div className="bg-red-100 text-red-700 p-sm rounded mb-md text-sm">
            {error}
          </div>
        )}
        {signedInUser && <p role="status">{t("fix.recovery")}</p>}
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

          {!signedInUser && (
            <>
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
            </>
          )}
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
              {COLORADO_COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">
              {t("register.foodBankId")}{" "}
              <span className="text-muted font-normal">
                {t("register.optional")}
              </span>
            </label>
            <input
              type="text"
              className="input"
              value={foodBankId}
              onChange={(e) => setFoodBankId(e.target.value)}
              placeholder={t("register.foodBankIdPlaceholder")}
            />
            <p className="text-xs text-muted mt-xs">
              {t("register.foodBankIdHelp")}
            </p>
          </div>

          <div className="flex gap-md">
            <div className="flex-1">
              <label className="label">{t("register.adults")}</label>
              <input
                type="number"
                min="0"
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
          {t("register.alreadyHaveAccount")}{" "}
          <Link href="/login" className="text-blue-600 hover:underline">
            {t("register.loginHere")}
          </Link>
        </p>
      </div>
    </div>
  );
}
