"use client";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";

export default function HomePage() {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  if (loading) return <div className="text-center mt-md">{t("common.loading")}</div>;

  return (
    <div className="flex flex-col items-center gap-lg">
      <h1 className="text-3xl font-bold text-center" style={{ color: "var(--color-primary)" }}>
        Front Range Food Source
      </h1>

      <div className="card text-center" style={{ maxWidth: "600px" }}>
        <p className="mb-md text-lg">
          {t("home.welcome")}
        </p>

        {user ? (
          <div className="flex flex-col gap-md">
            <p>Hello, <strong>{user.displayName || user.email}</strong>!</p>
            <div className="flex gap-md justify-center">
              <Link href="/request" className="btn btn-primary">
                {t("request.title")}
              </Link>
              {/* We'll add Admin link here later if user is admin */}
            </div>
            <button
              onClick={() => auth.signOut()}
              className="btn btn-secondary mt-md"
            >
              {t("common.logout")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-md">
            <p>{t("home.pleaseLogin")}</p>
            <div className="flex gap-md justify-center">
              <Link href="/login" className="btn btn-primary">
                {t("common.login")}
              </Link>
              <Link href="/register" className="btn btn-secondary">
                {t("common.register")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
