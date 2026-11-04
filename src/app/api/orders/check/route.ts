import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { identity, failure, HttpError } from "@/lib/server/http";
export async function GET(request: Request) {
  try {
    const { uid } = await identity(request);
    const batchId = new URL(request.url).searchParams.get("batchId");
    if (!batchId || !/^[\w-]{1,150}$/.test(batchId))
      throw new HttpError(400, "invalidInput");
    const snapshot = await adminDb
      .collection("orders")
      .where("userId", "==", uid)
      .where("batchId", "==", batchId)
      .limit(1)
      .get();
    return NextResponse.json(
      { hasOrdered: !snapshot.empty },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
