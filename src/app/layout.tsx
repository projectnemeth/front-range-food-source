import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";
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
        <AuthProvider>
          <main className="container mt-md">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
