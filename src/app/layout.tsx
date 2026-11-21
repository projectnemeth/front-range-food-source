import type { Metadata } from "next";
import ApplicationAuth from "@/components/ApplicationAuth";
import { LanguageProvider } from "@/context/LanguageContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Front Range Food Source",
  description: "Food request management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>
          <ApplicationAuth>
            <main className="container mt-md">
              <div className="flex justify-end mb-md">
                <LanguageSwitcher />
              </div>
              {children}
            </main>
          </ApplicationAuth>
        </LanguageProvider>
      </body>
    </html>
  );
}
