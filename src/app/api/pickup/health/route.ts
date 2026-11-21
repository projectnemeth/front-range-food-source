import { NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import { FirebaseConfigurationError } from "@/lib/firebase-admin-config";
import { BUILD } from "@/lib/pickup/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    getAdminServices();
    return NextResponse.json(
      {
        build: BUILD,
        firebaseConfigured: true,
        pickupEnabled: process.env.PICKUP_HOSTED_ENABLED === "true",
        configurationOnly: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        build: BUILD,
        firebaseConfigured: false,
        error:
          error instanceof FirebaseConfigurationError
            ? error.message
            : "Firebase server configuration is unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
