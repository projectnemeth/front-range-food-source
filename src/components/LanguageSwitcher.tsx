"use client";

import { useLanguage } from "@/context/LanguageContext";

export default function LanguageSwitcher() {
    const { language, setLanguage } = useLanguage();

    return (
        <div className="flex gap-xs">
            <button
                onClick={() => setLanguage("en")}
                className={`px-3 py-2 text-sm rounded flex items-center gap-2 ${language === "en" ? "bg-primary text-white font-bold" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
            >
                <span>🇺🇸</span> English
            </button>
            <button
                onClick={() => setLanguage("es")}
                className={`px-3 py-2 text-sm rounded flex items-center gap-2 ${language === "es" ? "bg-primary text-white font-bold" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
            >
                <span>🇲🇽</span> Español
            </button>
        </div>
    );
}
