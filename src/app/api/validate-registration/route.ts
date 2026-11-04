import { NextResponse } from "next/server";
// Duplicate checking is performed atomically after authentication by finalization.
// The former public endpoint exposed household membership and did not guarantee uniqueness.
export async function POST() {
  return NextResponse.json({ error: "refreshRequired" }, { status: 410 });
}
