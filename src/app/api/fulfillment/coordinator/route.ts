import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { identity, json, failure, HttpError } from "@/lib/server/http";
import { CoordinatorStore } from "@/lib/fulfillment/coordinator-store";
import { coordinatorCommandSchema } from "@/lib/fulfillment/coordinator-contracts";
import { WorkflowError } from "@/lib/fulfillment/workflow";
export const runtime = "nodejs";
const store = new CoordinatorStore(adminDb);
const headers = { "Cache-Control": "private, no-store" };
function enabled() {
  if (process.env.FULFILLMENT_PHASE_TWO_ENABLED !== "true")
    throw new HttpError(404, "notEnabled");
}
function errorResponse(error: unknown) {
  if (error instanceof WorkflowError)
    return NextResponse.json(
      { error: error.code },
      { status: error.code === "forbidden" ? 403 : 409, headers },
    );
  const response = failure(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function GET(request: Request) {
  try {
    enabled();
    const actor = await identity(request);
    return NextResponse.json(
      await store.read(
        actor.uid,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    enabled();
    const actor = await identity(request);
    const command = coordinatorCommandSchema.parse(await json(request));
    if (command.action === "staff" && command.active) {
      // Authorize before looking up another account, to avoid an account oracle.
      await store.read(actor.uid, { eventId: command.eventId });
      try {
        const account = await adminAuth.getUser(command.uid);
        if (account.disabled) throw new Error("disabled");
      } catch {
        throw new HttpError(400, "staffAccountUnavailable");
      }
    }
    return NextResponse.json(await store.execute(actor.uid, command), {
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
