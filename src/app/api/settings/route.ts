import { NextResponse } from "next/server";
import { publicOrdering } from "@/lib/server/batches";
import { failure } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await publicOrdering(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
