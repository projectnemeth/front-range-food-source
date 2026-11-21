"use client";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/context/AuthContext";
export default function ApplicationAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  // Pickup uses its own coordinator/device sessions; it must not fetch a food-order profile.
  if (path === "/pickup" || path.startsWith("/pickup/")) return <>{children}</>;
  return <AuthProvider>{children}</AuthProvider>;
}
