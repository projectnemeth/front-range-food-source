import { NextRequest, NextResponse } from "next/server";
import { enabled, coordinator } from "@/lib/pickup/auth";
import { hostedHtml } from "@/lib/pickup/template";
import { pickupFailure } from "@/lib/pickup/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    enabled();
    const admin = request.nextUrl.searchParams.get("coordinator") === "1";
    if (admin) {
      try {
        await coordinator(request);
      } catch {
        return NextResponse.redirect(new URL("/pickup/manage", request.url));
      }
    }
    return new NextResponse(hostedHtml(admin), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      },
    });
  } catch (e) {
    return pickupFailure(e);
  }
}
