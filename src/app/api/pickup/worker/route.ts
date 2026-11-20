import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { enabled, matches } from "@/lib/pickup/auth";
import { PickupStore } from "@/lib/pickup/store";
import { pickupFailure } from "@/lib/pickup/api";
import { PickupError } from "@/lib/pickup/model";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    enabled();
    const secret = process.env.CRON_SECRET;
    if (
      !secret ||
      !matches(request.headers.get("authorization") || "", "Bearer " + secret)
    )
      throw new PickupError(401, "Worker authentication required.");
    return NextResponse.json(await new PickupStore(adminDb).worker(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return pickupFailure(e);
  }
}
