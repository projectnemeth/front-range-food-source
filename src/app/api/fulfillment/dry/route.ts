import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { identity, json, failure, HttpError } from "@/lib/server/http";
import { FulfillmentStore } from "@/lib/fulfillment/store";
import { WorkflowError } from "@/lib/fulfillment/workflow";

export const runtime = "nodejs";
const store = new FulfillmentStore(adminDb);
function enabled() {
  if (process.env.FULFILLMENT_PHASE_TWO_ENABLED !== "true")
    throw new HttpError(404, "notEnabled");
}
function errorResponse(error: unknown) {
  if (error instanceof WorkflowError) {
    const status = ["forbidden", "bridgeRequired"].includes(error.code)
      ? 403
      : error.code === "orderNotFound"
        ? 404
        : 409;
    return NextResponse.json(
      { error: error.code },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const response = failure(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function GET(request: Request) {
  try {
    enabled();
    const actor = await identity(request);
    const query = Object.fromEntries(
      new URL(request.url).searchParams.entries(),
    );
    return NextResponse.json(await store.readDry(actor.uid, query), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    enabled();
    const actor = await identity(request);
    return NextResponse.json(
      await store.execute(actor.uid, await json(request), "dry"),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
