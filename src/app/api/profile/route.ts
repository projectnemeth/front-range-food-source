import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { identity, failure } from "@/lib/server/http";
export async function GET(request: Request) {
  try {
    const { uid } = await identity(request);
    const snap = await adminDb.doc(`users/${uid}`).get();
    return NextResponse.json(
      snap.exists ? snap.data() : { error: "incompleteProfile" },
      {
        status: snap.exists ? 200 : 404,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
