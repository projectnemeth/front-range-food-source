"use client";

import { useLanguage } from "@/context/LanguageContext";

export default function LanguageSwitcher() {
    const { language, setLanguage } = useLanguage();

    return (
        <div className="flex gap-xs">
            <button
                onClick={() => setLanguage("en")}
                className={`px-2 py-1 text-sm rounded ${language === "en" ? "bg-primary text-white font-bold" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
            >
                English
            </button>
            <button
                onClick={() => setLanguage("es")}
                className={`px-2 py-1 text-sm rounded ${language === "es" ? "bg-primary text-white font-bold" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
            >
                Español
            </button>
        </div>
    );
}
