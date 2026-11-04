import { NextResponse } from "next/server";
import { identity, failure, json, HttpError } from "@/lib/server/http";
import { finalizeProfile } from "@/lib/server/profiles";
import { rateLimit } from "@/lib/server/rate-limit";
export async function POST(request: Request) {
  try {
    const token = await identity(request);
    if (!token.email) throw new HttpError(400, "invalidInput");
    await rateLimit(token.uid, "registration", 10);
    return NextResponse.json(
      await finalizeProfile(token.uid, token.email, await json(request)),
    );
  } catch (e) {
    return failure(e);
  }
}
