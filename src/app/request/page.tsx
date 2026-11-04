"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { checklistConfig } from "@/lib/catalog";
import { formatPickupDate } from "@/lib/dates";
import { message as errorMessage } from "@/lib/messages";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

export default function RequestPage() {
  const {
    user,
    profile,
    profileError,
    refreshProfile,
    loading: authLoading,
  } = useAuth();
  const router = useRouter();
  const { t, language } = useLanguage();

  const [isFormOpen, setIsFormOpen] = useState<boolean | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [checkLoading, setCheckLoading] = useState(true);
  const [checkError, setCheckError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [hasOrdered, setHasOrdered] = useState(false);
  const [nextPickupDate, setNextPickupDate] = useState("");
  const priorPickup = useRef<{ id: string | null; date: string } | null>(null);

  // Wizard State
  const [step, setStep] = useState(1);

  // Form States
  const [confirmedPickup, setConfirmedPickup] = useState(false);
  const [disclaimerAgreed, setDisclaimerAgreed] = useState(false);

  // Dietary
  const [hasDietaryRestrictions, setHasDietaryRestrictions] = useState<
    boolean | null
  >(null);
  const [glutenFreeCount, setGlutenFreeCount] = useState<number>(0);
  const [veganCount, setVeganCount] = useState<number>(0);

  // Baby
  const [hasBaby, setHasBaby] = useState<boolean | null>(null);
  const [babyNeeds, setBabyNeeds] = useState<{
    diapers: boolean;
    formula: boolean;
  }>({ diapers: false, formula: false });
  const [diaperSize, setDiaperSize] = useState("");
  const [formulaType, setFormulaType] = useState("");
  const [babyDetails, setBabyDetails] = useState("");

  // Checklist Items
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>(
    {},
  );

  // General Items (Other)
  const [items, setItems] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("settingsError");
        const data = await response.json();
        if (cancelled) return;
        if (
          priorPickup.current &&
          (priorPickup.current.id !== data.currentBatchId ||
            priorPickup.current.date !== data.nextPickupDate)
        ) {
          setConfirmedPickup(false);
          setDisclaimerAgreed(false);
          setStep(1);
          setMessage(t("fix.staleBatch"));
        }
        priorPickup.current = {
          id: data.currentBatchId,
          date: data.nextPickupDate,
        };
        setIsFormOpen(data.isFormOpen === true);
        setCurrentBatchId(data.currentBatchId);
        setNextPickupDate(data.nextPickupDate);
        setScheduleMessage("");
      } catch {
        if (!cancelled) {
          setIsFormOpen(false);
          setScheduleMessage(t("fix.settingsError"));
        }
      } finally {
        if (!cancelled) setLoadingSettings(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [t, retry]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setCheckLoading(true);
      setCheckError(false);
      setHasOrdered(false);
      if (!user || !currentBatchId) {
        if (!cancelled) setCheckLoading(false);
        return;
      }
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/orders/check?batchId=${encodeURIComponent(currentBatchId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) throw new Error("checkError");
        const data = await response.json();
        if (!cancelled) setHasOrdered(data.hasOrdered);
      } catch {
        if (!cancelled) setCheckError(true);
      } finally {
        if (!cancelled) setCheckLoading(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [user, currentBatchId, retry]);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  const handleCheckboxChange = (key: string) => {
    setSelectedItems((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    // Validation for Step 1
    if (!confirmedPickup) {
      alert(t("request.pickupConfirmation"));
      return;
    }
    setStep(2);
    window.scrollTo(0, 0);
  };

  const handleBack = () => {
    setStep(1);
    window.scrollTo(0, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !user ||
      !profile ||
      checkLoading ||
      checkError ||
      submitting ||
      !isFormOpen
    )
      return;
    if (hasOrdered) {
      setMessage(t("request.alreadyOrdered"));
      return;
    }

    setSubmitting(true);
    try {
      const orderPayload = {
        selectedItems: Object.keys(selectedItems).filter(
          (key) => selectedItems[key],
        ),
        otherItems: items,
        confirmedPickup,
        disclaimerAgreed,
        disclaimerVersion: "2026-11-03",
        batchId: currentBatchId,
        dietaryRestrictions: {
          hasRestrictions: hasDietaryRestrictions,
          glutenFreeCount: hasDietaryRestrictions ? glutenFreeCount : 0,
          veganCount: hasDietaryRestrictions ? veganCount : 0,
        },
        babyNeeds: {
          hasBaby,
          needs: hasBaby
            ? {
                diapers: babyNeeds.diapers,
                formula: babyNeeds.formula,
              }
            : null,
          details: hasBaby
            ? {
                diaperSize: babyNeeds.diapers ? diaperSize : "",
                formulaType: babyNeeds.formula ? formulaType : "",
                other: babyDetails,
              }
            : null,
        },
      };

      const token = await user.getIdToken();
      const response = await fetch("/api/orders/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(orderPayload),
      });

      if (response.ok) {
        setMessage(t("request.successMessage"));
        setHasOrdered(true);
        // Reset form
        setItems("");
        setConfirmedPickup(false);
        setHasDietaryRestrictions(null);
        setGlutenFreeCount(0);
        setVeganCount(0);
        setHasBaby(null);
        setBabyNeeds({ diapers: false, formula: false });
        setDiaperSize("");
        setFormulaType("");
        setBabyDetails("");
        setDisclaimerAgreed(false);
        setSelectedItems({});
        setStep(1);
      } else {
        const data = await response.json();
        throw new Error(data.error || "serverError");
      }
    } catch (err) {
      console.error(err);
      setMessage(
        errorMessage(
          language,
          err instanceof Error ? err.message : "serverError",
        ),
      );
      setRetry((n) => n + 1);
    }
    setSubmitting(false);
  };

  if (profileError)
    return (
      <div>
        {t("fix.profileError")}{" "}
        <button onClick={() => void refreshProfile()}>{t("fix.retry")}</button>
      </div>
    );
  if (!authLoading && user && !profile)
    return <Link href="/register">{t("fix.complete")}</Link>;
  if (authLoading || loadingSettings || checkLoading)
    return <div className="text-center mt-md">{t("common.loading")}</div>;

  if (checkError)
    return (
      <div role="alert">
        {t("fix.checkError")}{" "}
        <button onClick={() => setRetry((n) => n + 1)}>{t("fix.retry")}</button>
      </div>
    );
  if (!isFormOpen) {
    return (
      <div className="flex justify-center">
        <div className="card text-center" style={{ maxWidth: "500px" }}>
          <h2
            className="text-xl font-bold mb-md"
            style={{ color: "var(--color-secondary)" }}
          >
            {t("request.closedTitle")}
          </h2>
          <p>{t("request.closedMessage")}</p>
          {scheduleMessage && (
            <p className="text-sm text-muted mt-sm">{scheduleMessage}</p>
          )}
          <button
            onClick={() => router.push("/")}
            className="btn btn-secondary mt-md"
          >
            {t("common.backToHome")}
          </button>
        </div>
      </div>
    );
  }

  if (hasOrdered) {
    return (
      <div className="flex justify-center">
        <div className="card text-center" style={{ maxWidth: "500px" }}>
          <h2 className="text-xl font-bold mb-md text-green-700">
            {t("request.successMessage")}
          </h2>
          <p>{t("request.alreadyOrdered")}</p>
          <button
            onClick={() => router.push("/")}
            className="btn btn-secondary mt-md"
          >
            {t("common.backToHome")}
          </button>
        </div>
      </div>
    );
  }

  const formattedPickupDate = nextPickupDate
    ? formatPickupDate(nextPickupDate, language)
    : "...";

  return (
    <div className="flex justify-center">
      <div
        className={`card ${step === 2 ? "bg-green-50" : ""}`}
        style={{ width: "100%", maxWidth: "800px" }}
      >
        <h1 className="text-2xl font-bold mb-md text-center">
          {t("request.title")}
        </h1>

        {scheduleMessage && (
          <div className="text-center text-sm text-muted mb-md">
            {scheduleMessage}
          </div>
        )}

        {/* Important Pickup Notice */}
        <div className="bg-blue-50 border border-blue-200 p-md rounded mb-md text-blue-900">
          <p className="font-medium mb-sm">
            {t("request.pickupNotice")}
            <span className="font-bold">{formattedPickupDate}</span>.
          </p>
        </div>

        {message && (
          <div
            className={`p-md mb-md rounded ${message.includes(t("common.error")) ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}
            style={{
              backgroundColor: message.includes(t("common.error"))
                ? "#FEE2E2"
                : "#D1FAE5",
              color: message.includes(t("common.error"))
                ? "#991B1B"
                : "#065F46",
            }}
          >
            {message}
          </div>
        )}

        <form
          onSubmit={step === 1 ? handleNext : handleSubmit}
          className="flex flex-col gap-lg"
        >
          {step === 1 && (
            <>
              {/* 1. Pickup Confirmation */}
              <div>
                <label className="flex items-start gap-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={confirmedPickup}
                    onChange={(e) => setConfirmedPickup(e.target.checked)}
                    required
                  />
                  <span className="font-medium">
                    {t("request.pickupConfirmation")}
                    {formattedPickupDate}
                    {t("request.pickupConfirmationTime")}
                  </span>
                </label>
              </div>

              <hr className="border-gray-200" />

              {/* 2. Dietary Restrictions */}
              <div>
                <label className="block font-bold mb-sm">
                  {t("request.dietary.hasRestrictions")}
                </label>
                <div className="flex gap-md mb-sm">
                  <label className="flex items-center gap-xs cursor-pointer">
                    <input
                      type="radio"
                      name="dietary"
                      checked={hasDietaryRestrictions === true}
                      onChange={() => setHasDietaryRestrictions(true)}
                    />
                    {t("common.yes")}
                  </label>
                  <label className="flex items-center gap-xs cursor-pointer">
                    <input
                      type="radio"
                      name="dietary"
                      checked={hasDietaryRestrictions === false}
                      onChange={() => setHasDietaryRestrictions(false)}
                    />
                    {t("common.no")}
                  </label>
                </div>

                {hasDietaryRestrictions === true && (
                  <div className="pl-md border-l-2 border-gray-200 flex flex-col gap-sm mt-sm">
                    <div>
                      <label className="label">
                        {t("request.dietary.glutenFree")}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="6"
                        className="input w-24"
                        value={glutenFreeCount}
                        onChange={(e) =>
                          setGlutenFreeCount(Number(e.target.value))
                        }
                      />
                    </div>
                    <div>
                      <label className="label">
                        {t("request.dietary.vegan")}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="6"
                        className="input w-24"
                        value={veganCount}
                        onChange={(e) => setVeganCount(Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>

              <hr className="border-gray-200" />

              {/* 3. Baby Needs */}
              <div>
                <label className="block font-bold mb-sm">
                  {t("request.baby.hasBaby")}
                </label>
                <div className="flex gap-md mb-sm">
                  <label className="flex items-center gap-xs cursor-pointer">
                    <input
                      type="radio"
                      name="baby"
                      checked={hasBaby === true}
                      onChange={() => setHasBaby(true)}
                    />
                    {t("common.yes")}
                  </label>
                  <label className="flex items-center gap-xs cursor-pointer">
                    <input
                      type="radio"
                      name="baby"
                      checked={hasBaby === false}
                      onChange={() => setHasBaby(false)}
                    />
                    {t("common.no")}
                  </label>
                </div>

                {hasBaby === true && (
                  <div className="pl-md border-l-2 border-gray-200 flex flex-col gap-md mt-sm">
                    <div>
                      <label className="label mb-sm block">
                        {t("request.baby.needsLabel")}
                      </label>
                      <div className="flex flex-col gap-xs">
                        <label className="flex items-center gap-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={babyNeeds.diapers}
                            onChange={(e) =>
                              setBabyNeeds({
                                ...babyNeeds,
                                diapers: e.target.checked,
                              })
                            }
                          />
                          {t("request.baby.diapers")}
                        </label>
                        <label className="flex items-center gap-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={babyNeeds.formula}
                            onChange={(e) =>
                              setBabyNeeds({
                                ...babyNeeds,
                                formula: e.target.checked,
                              })
                            }
                          />
                          {t("request.baby.formula")}
                        </label>
                      </div>
                    </div>

                    {babyNeeds.diapers && (
                      <div>
                        <label className="label">
                          {t("request.baby.diaperSize")}
                        </label>
                        <input
                          type="text"
                          className="input"
                          value={diaperSize}
                          onChange={(e) => setDiaperSize(e.target.value)}
                        />
                      </div>
                    )}

                    {babyNeeds.formula && (
                      <div>
                        <label className="label">
                          {t("request.baby.formulaType")}
                        </label>
                        <input
                          type="text"
                          className="input"
                          value={formulaType}
                          onChange={(e) => setFormulaType(e.target.value)}
                        />
                      </div>
                    )}

                    <div>
                      <label className="label">
                        {t("request.baby.otherDetails")}
                      </label>
                      <textarea
                        className="input"
                        rows={2}
                        value={babyDetails}
                        onChange={(e) => setBabyDetails(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              <hr className="border-gray-200" />

              {/* 4. Pantry Food Items */}
              <div>
                <h3 className="font-bold text-lg mb-sm">
                  {t("request.sections.pantry")}
                </h3>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.pantry.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* 5. Additional Pantry */}
              <div>
                <h3 className="font-bold text-lg mb-sm">
                  {t("request.sections.additionalPantry")}
                </h3>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.additionalPantry.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* 6. Drinks */}
              <div>
                <h3 className="font-bold text-lg mb-sm">
                  {t("request.sections.drinks")}
                </h3>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.drinks.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* 7. Home Goods */}
              <div>
                <h3 className="font-bold text-lg mb-sm">
                  {t("request.sections.homeGoods")}
                </h3>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.homeGoods.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* 8. Pet Supplies */}
              <div>
                <h3 className="font-bold text-lg mb-sm">
                  {t("request.sections.petSupplies")}
                </h3>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.petSupplies.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* 9. Snacks */}
              <div>
                <h3 className="font-bold text-lg mb-sm">
                  {t("request.sections.snacks")}
                </h3>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.snacks.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-md pt-md">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="btn btn-secondary"
                >
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn btn-primary flex-1">
                  {t("request.next")}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <div>
              {/* 1. Fresh & Refrigerated Items */}
              <div>
                <h2 className="text-xl font-bold mb-sm text-green-700">
                  {t("request.sections.freshRefrigerated")}
                </h2>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.freshRefrigerated.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-gray-200 my-md" />

              {/* 2. Frozen Meat & Prepared Meals */}
              <div>
                <h2 className="text-xl font-bold mb-sm text-blue-700">
                  {t("request.sections.frozen")}
                </h2>
                <p className="text-sm text-muted mb-sm">
                  {t("request.sections.requestedItems")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {checklistConfig.frozen.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-sm cursor-pointer p-xs hover:bg-gray-50 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedItems[key]}
                        onChange={() => handleCheckboxChange(key)}
                      />
                      <span>{t(`request.items.${key}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-gray-200 my-md" />

              <label className="label">
                {t("fix.other")}
                <textarea
                  className="input"
                  maxLength={2000}
                  value={items}
                  onChange={(e) => setItems(e.target.value)}
                />
              </label>
              {/* 3. Disclaimer */}
              <div className="bg-yellow-50 border border-yellow-200 p-md rounded mb-md">
                <h3 className="font-bold text-yellow-900 mb-xs">
                  {t("request.disclaimer.title")}
                </h3>
                <p className="text-sm text-yellow-800 mb-sm">
                  {t("request.disclaimer.text").replace(
                    "{date}",
                    formattedPickupDate,
                  )}
                </p>
                <label className="flex items-center gap-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disclaimerAgreed}
                    onChange={(e) => setDisclaimerAgreed(e.target.checked)}
                    required
                  />
                  <span className="font-medium text-yellow-900">
                    {t("request.disclaimer.agree")}
                  </span>
                </label>
              </div>

              <div className="flex gap-md pt-md">
                <button
                  type="button"
                  onClick={handleBack}
                  className="btn btn-secondary"
                  disabled={submitting || checkLoading || checkError}
                >
                  {t("request.back")}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary flex-1"
                  disabled={submitting || checkLoading || checkError}
                >
                  {submitting
                    ? t("request.submitting")
                    : t("request.submitOrder")}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
