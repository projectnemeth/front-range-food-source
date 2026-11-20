import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "../firebase-admin";
import { key, PickupError } from "./model";
import { rateLimit } from "../server/rate-limit";
export const SESSION_SECONDS = 180 * 86400;
export const deviceCookie = () =>
  process.env.NODE_ENV === "production" ? "__Host-frfs_pickup" : "frfs_pickup";
export const coordinatorCookie = () =>
  process.env.NODE_ENV === "production"
    ? "__Host-frfs_pickup_coordinator"
    : "frfs_pickup_coordinator";
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
export interface Actor {
  id: string;
  admin: boolean;
  owner?: boolean;
  device?: string;
  credential?: string;
  label?: string;
  expiresAt?: number;
}
export function enabled() {
  if (process.env.PICKUP_HOSTED_ENABLED !== "true")
    throw new PickupError(404, "Hosted pickup is not enabled.");
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin)
    throw new PickupError(
      403,
      "Open the app on its own website before submitting changes.",
    );
}
export function matches(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function coordinatorRole(uid: string): Promise<Actor> {
  const [user, grant] = await adminDb.getAll(
    adminDb.doc(`users/${uid}`),
    adminDb.doc(`pickupCoordinators/${uid}`),
  );
  const owner = user.data()?.role === "ADMIN";
  if (!owner && grant.data()?.active !== true)
    throw new PickupError(403, "This account needs pickup coordinator access.");
  return { id: `user:${uid}`, admin: true, owner };
}
export async function coordinator(request: NextRequest) {
  const session = request.cookies.get(coordinatorCookie())?.value;
  if (!session)
    throw new PickupError(
      401,
      "Coordinator sign-in required. Open /pickup/manage.",
    );
  let uid: string;
  try {
    uid = (await adminAuth.verifySessionCookie(session, true)).uid;
  } catch {
    throw new PickupError(
      401,
      "Coordinator session expired. Open /pickup/manage.",
    );
  }
  return coordinatorRole(uid);
}
export async function device(request: NextRequest): Promise<Actor> {
  const credential = request.cookies.get(deviceCookie())?.value;
  if (!credential || !/^\w{32}\.[a-f0-9]{64}$/.test(credential))
    throw new PickupError(
      401,
      "DEVICE_ACCESS_REQUIRED: Pair this iPad once with a coordinator PIN.",
    );
  const [id] = credential.split("."),
    ref = adminDb.doc(`pickupDevices/${id}`),
    now = Date.now();
  return adminDb.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (
      !d ||
      d.revokedAt ||
      typeof d.expiresAt !== "number" ||
      !Number.isFinite(d.expiresAt) ||
      d.expiresAt <= now ||
      !matches(d.tokenHash, key(credential))
    )
      throw new PickupError(
        401,
        "DEVICE_ACCESS_REQUIRED: Device expired or revoked. Ask a coordinator to pair it again.",
      );
    if (!d.lastSeenAt || now - d.lastSeenAt > 86400000)
      tx.update(ref, {
        lastSeenAt: now,
        expiresAt: now + SESSION_SECONDS * 1000,
      });
    return {
      id: `device:${id}`,
      device: id,
      admin: false,
      credential,
      label: d.label as string,
      expiresAt: now + SESSION_SECONDS * 1000,
    };
  });
}
export async function actor(request: NextRequest): Promise<Actor> {
  if (request.cookies.has(coordinatorCookie())) {
    try {
      return await coordinator(request);
    } catch (error) {
      // An expired coordinator session must not lock out a separately paired iPad.
      if (!(error instanceof PickupError) || ![401, 403].includes(error.status))
        throw error;
    }
  }
  return device(request);
}
export function renewCookie(response: NextResponse, who: Actor) {
  if (who.credential)
    response.cookies.set(deviceCookie(), who.credential, {
      ...cookieOptions,
      maxAge: SESSION_SECONDS,
    });
}
export async function createPairing(label: string, who: Actor) {
  const now = Date.now();
  for (let tries = 0; tries < 10; tries++) {
    const code = String(randomInt(1000000)).padStart(6, "0"),
      ref = adminDb.doc(`pickupPairings/${key(code)}`);
    const saved = await adminDb.runTransaction(async (tx) => {
      const d = (await tx.get(ref)).data();
      if (d && !d.usedAt && d.expiresAt > now) return false;
      tx.set(ref, {
        label,
        createdBy: who.id,
        expiresAt: now + 10 * 60000,
        usedAt: null,
      });
      return true;
    });
    if (saved)
      return {
        code,
        label,
        expiresAt: new Date(now + 10 * 60000).toISOString(),
      };
  }
  throw new PickupError(503, "Try creating a PIN again.");
}
export async function pairDevice(code: string, request: NextRequest) {
  // A global budget also bounds distributed attempts; trusted platform IP adds a per-source budget.
  await rateLimit("pickup-pairing", "global", 60);
  const ip =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for") || "unknown"
      : "local";
  await rateLimit(ip, "pickup-pairing", 5);
  const ref = adminDb.doc(`pickupPairings/${key(code)}`),
    id = randomBytes(16).toString("hex"),
    credential = id + "." + randomBytes(32).toString("hex"),
    now = Date.now();
  const result = await adminDb.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d || d.usedAt || d.expiresAt <= now)
      throw new PickupError(
        401,
        "Incorrect, expired or already-used pairing PIN.",
      );
    const expiresAt = now + SESSION_SECONDS * 1000;
    tx.update(ref, { usedAt: now, deviceId: id });
    tx.create(adminDb.doc(`pickupDevices/${id}`), {
      label: d.label,
      tokenHash: key(credential),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      revokedAt: null,
      enrolledBy: d.createdBy,
    });
    return {
      label: d.label as string,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });
  return { ...result, credential };
}
