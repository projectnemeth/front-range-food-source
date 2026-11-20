import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { identity, json } from "@/lib/server/http";
import {
  sameOrigin,
  enabled,
  coordinatorRole,
  coordinator,
  coordinatorCookie,
  cookieOptions,
} from "@/lib/pickup/auth";
import { pickupFailure } from "@/lib/pickup/api";
import { PickupError } from "@/lib/pickup/model";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    enabled();
    sameOrigin(request);
    const body = z
      .object({
        action: z.enum(["login", "logout", "grant", "revoke"]),
        email: z.string().email().optional(),
        uid: z.string().max(128).optional(),
      })
      .strict()
      .parse(await json(request));
    if (body.action === "logout") {
      const response = NextResponse.json({ ok: true });
      response.cookies.set(coordinatorCookie(), "", {
        ...cookieOptions,
        maxAge: 0,
      });
      return response;
    }
    if (body.action === "grant" || body.action === "revoke") {
      const who = await coordinator(request);
      if (!who.owner)
        throw new PickupError(
          403,
          "Only an existing application administrator can manage coordinator access.",
        );
      if (body.action === "grant") {
        if (!body.email)
          throw new PickupError(400, "Enter the coordinator email.");
        let account;
        try {
          account = await adminAuth.getUserByEmail(body.email);
        } catch {
          throw new PickupError(
            404,
            "Create this person's Firebase account first, then grant access.",
          );
        }
        if (account.disabled)
          throw new PickupError(409, "That account is disabled.");
        await adminDb
          .doc(`pickupCoordinators/${account.uid}`)
          .set({
            active: true,
            grantedBy: who.id,
            grantedAt: new Date().toISOString(),
          });
        return NextResponse.json({
          ok: true,
          message: "Coordinator access granted. Share /pickup/manage.",
        });
      }
      if (!body.uid) throw new PickupError(400, "Choose a coordinator.");
      await adminDb
        .doc(`pickupCoordinators/${body.uid}`)
        .set({ active: false, revokedBy: who.id }, { merge: true });
      return NextResponse.json({
        ok: true,
        message: "Coordinator access revoked.",
      });
    }
    const token = await identity(request);
    await coordinatorRole(token.uid);
    // Session-cookie exchange requires a recent interactive login.
    if (Date.now() / 1000 - token.auth_time > 300)
      throw new PickupError(401, "Sign in again to open coordinator controls.");
    const duration = 5 * 86400000,
      session = await adminAuth.createSessionCookie(
        request.headers.get("authorization")!.slice(7),
        { expiresIn: duration },
      );
    const response = NextResponse.json({ ok: true });
    response.cookies.set(coordinatorCookie(), session, {
      ...cookieOptions,
      maxAge: duration / 1000,
    });
    return response;
  } catch (e) {
    return pickupFailure(e);
  }
}
export async function GET(request: NextRequest) {
  try {
    enabled();
    const who = await coordinator(request);
    const grants = who.owner
      ? (await adminDb.collection("pickupCoordinators").get()).docs.map(
          (d) => ({ uid: d.id, active: d.data().active }),
        )
      : [];
    return NextResponse.json(
      { owner: who.owner || false, coordinators: grants },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return pickupFailure(e);
  }
}
