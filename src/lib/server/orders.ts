import { adminDb } from "../firebase-admin";
import { orderSchema } from "../schemas";
import { freshKeys } from "../catalog";
import { readOrdering } from "./batches";
import { HttpError } from "./http";
export async function submitOrder(uid: string, input: unknown) {
  const data = orderSchema.parse(input);
  return adminDb.runTransaction(async (tx) => {
    const profile = (await tx.get(adminDb.doc(`users/${uid}`))).data();
    if (!profile?.familySize || !profile.displayName || !profile.email)
      throw new HttpError(403, "incompleteProfile");
    const reservation = adminDb.doc(
      `orderReservations/${data.batchId}/users/${uid}`,
    );
    const prior = await tx.get(reservation);
    if (prior.exists)
      return { id: prior.data()!.orderId as string, replayed: true };
    const old = await tx.get(
      adminDb
        .collection("orders")
        .where("batchId", "==", data.batchId)
        .where("userId", "==", uid)
        .limit(1),
    );
    if (!old.empty) {
      tx.create(reservation, { orderId: old.docs[0].id });
      return { id: old.docs[0].id, replayed: true };
    }
    const state = await readOrdering(tx);
    if (state.batch?.id !== data.batchId)
      throw new HttpError(409, "staleBatch");
    if (!state.open) throw new HttpError(409, "orderingClosed");
    const total = profile.familySize.total;
    if (
      data.dietaryRestrictions.glutenFreeCount > total ||
      data.dietaryRestrictions.veganCount > total
    )
      throw new HttpError(400, "invalidInput");
    const ref = adminDb.collection("orders").doc();
    const now = new Date().toISOString();
    state.commitActivation();
    tx.create(ref, {
      ...data,
      userId: uid,
      userName: profile.displayName,
      userEmail: profile.email,
      userPhone: profile.phone ?? "",
      familySize: profile.familySize,
      pickupDate: state.batch!.pickupDate,
      dietaryRestrictions: {
        ...data.dietaryRestrictions,
        glutenFreeCount: data.dietaryRestrictions.hasRestrictions
          ? data.dietaryRestrictions.glutenFreeCount
          : 0,
        veganCount: data.dietaryRestrictions.hasRestrictions
          ? data.dietaryRestrictions.veganCount
          : 0,
      },
      dryGoodsItems: data.selectedItems.filter((k) => !freshKeys.has(k)),
      freshGoodsItems: data.selectedItems.filter((k) => freshKeys.has(k)),
      createdAt: now,
      disclaimerAcceptedAt: now,
      status: "PENDING",
      packingStatus: { dryGoods: "PENDING", freshGoods: "PENDING" },
    });
    tx.create(reservation, { orderId: ref.id });
    return { id: ref.id, replayed: false };
  });
}
