import { createHash } from "node:crypto";
import { adminDb } from "../firebase-admin";
import { HttpError } from "./http";
export async function rateLimit(
  subject: string,
  action: string,
  maximum: number,
) {
  const window = Math.floor(Date.now() / 60000);
  const hash = createHash("sha256")
    .update(`${subject}:${action}:${window}`)
    .digest("hex");
  await adminDb.runTransaction(async (tx) => {
    const ref = adminDb.doc(`rateLimits/${hash}`);
    const snap = await tx.get(ref);
    const count = snap.data()?.count ?? 0;
    if (count >= maximum) throw new HttpError(429, "rateLimited");
    tx.set(ref, {
      count: count + 1,
      expiresAt: new Date((window + 2) * 60000),
    });
  });
}
