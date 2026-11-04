import { NextResponse } from "next/server";
import { identity, failure, json } from "@/lib/server/http";
import { submitOrder } from "@/lib/server/orders";
import { rateLimit } from "@/lib/server/rate-limit";
export async function POST(request: Request) {
  try {
    const { uid } = await identity(request);
    await rateLimit(uid, "orders", 30);
    return NextResponse.json(await submitOrder(uid, await json(request)));
  } catch (e) {
    return failure(e);
  }
}
