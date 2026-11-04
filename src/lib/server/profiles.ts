import { createHash, randomUUID } from "node:crypto";
import { adminDb } from "../firebase-admin";
import { profileSchema } from "../schemas";
import { HttpError } from "./http";
export function normalizedPhone(v: string) {
  return v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}
export function normalize(v: string) {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}
export function reservationId(kind: string, value: string) {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}
export async function finalizeProfile(
  uid: string,
  email: string,
  input: unknown,
) {
  const data = profileSchema.parse(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    const foodBankId = data.foodBankId || `FB-${randomUUID()}`;
    const values = {
      phone: normalizedPhone(data.phone),
      address: normalize(data.address),
      foodBankId: normalize(foodBankId),
      name: normalize(`${data.firstName} ${data.lastName}`),
    };
    try {
      return await adminDb.runTransaction(async (tx) => {
        const ref = adminDb.doc(`users/${uid}`);
        if ((await tx.get(ref)).exists)
          return { success: true, replayed: true };
        const refs = Object.entries(values).map(([kind, value]) =>
          adminDb.doc(`profileReservations/${reservationId(kind, value)}`),
        );
        const snaps = await tx.getAll(...refs);
        const kinds = Object.keys(values);
        for (let i = 0; i < snaps.length; i++)
          if (snaps[i].exists)
            throw new HttpError(
              409,
              `duplicate${kinds[i][0].toUpperCase()}${kinds[i].slice(1)}`,
            );
        // Legacy fallback until reservations have been backfilled; migration remains required for normalized legacy values.
        const queries = [
          adminDb.collection("users").where("phone", "==", data.phone),
          adminDb.collection("users").where("address", "==", data.address),
          adminDb.collection("users").where("foodBankId", "==", foodBankId),
          adminDb
            .collection("users")
            .where("firstName", "==", data.firstName)
            .where("lastName", "==", data.lastName),
        ];
        for (let i = 0; i < queries.length; i++)
          if (!(await tx.get(queries[i].limit(1))).empty)
            throw new HttpError(
              409,
              [
                "duplicatePhone",
                "duplicateAddress",
                "duplicateFoodBankId",
                "duplicateName",
              ][i],
            );
        tx.create(ref, {
          ...data,
          uid,
          email,
          foodBankId,
          displayName: `${data.firstName} ${data.lastName}`,
          familySize: {
            ...data.familySize,
            total:
              data.familySize.adults +
              data.familySize.children +
              data.familySize.seniors,
          },
          role: "USER",
          createdAt: new Date().toISOString(),
        });
        refs.forEach((r) => tx.create(r, { uid }));
        return { success: true, replayed: false };
      });
    } catch (error) {
      if (
        data.foodBankId ||
        !(error instanceof HttpError) ||
        error.code !== "duplicateFoodBankId" ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new HttpError(500, "serverError");
}
