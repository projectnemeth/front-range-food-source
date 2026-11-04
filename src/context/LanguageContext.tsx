"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { translations } from "@/lib/translations";
import { messages } from "@/lib/messages";
type Language = "en" | "es" | "ru";
const valid = (v: string | null): v is Language =>
  v === "en" || v === "es" || v === "ru";
interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string) => string;
}
const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    const restore = () => {
      try {
        const stored = localStorage.getItem("language");
        if (valid(stored)) setLanguage(stored);
      } catch {
        /* Storage may be disabled. */
      }
    };
    // Defer external storage restoration until hydration has completed.
    const timer = setTimeout(restore, 0);
    window.addEventListener("storage", restore);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", restore);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const select = useCallback((lang: Language) => {
    setLanguage(lang);
    try {
      localStorage.setItem("language", lang);
    } catch {}
  }, []);
  const t = useCallback(
    (path: string): string => {
      let value: unknown = path.startsWith("fix.")
        ? messages[language]
        : translations[language];
      for (const key of (path.startsWith("fix.") ? path.slice(4) : path).split(
        ".",
      )) {
        if (!value || typeof value !== "object" || !(key in value)) return path;
        value = (value as Record<string, unknown>)[key];
      }
      return typeof value === "string" ? value : path;
    },
    [language],
  );
  return (
    <LanguageContext.Provider value={{ language, setLanguage: select, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider required");
  return value;
}
