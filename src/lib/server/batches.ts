import type { Transaction } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { orderingOpen } from "../dates";
export interface Batch {
  id: string;
  name: string;
  pickupDate: string;
  scheduledOpen: string;
  scheduledClose: string;
  status: string;
  createdAt: string;
}
export interface Settings {
  currentBatchId?: string;
  pendingBatchId?: string | null;
  isFormOpen?: boolean | null;
  nextPickupDate?: string;
  scheduledOpen?: string;
  scheduledClose?: string;
}
// Read-only resolution is safe inside the order transaction. Activation is written only after all transaction reads.
export async function readOrdering(tx: Transaction, now = Date.now()) {
  const settingsRef = adminDb.doc("settings/global");
  const settings = ((await tx.get(settingsRef)).data() as Settings) ?? {};
  const current = settings.currentBatchId
    ? ((
        await tx.get(adminDb.doc(`batches/${settings.currentBatchId}`))
      ).data() as Batch | undefined)
    : undefined;
  const pending = settings.pendingBatchId
    ? ((
        await tx.get(adminDb.doc(`batches/${settings.pendingBatchId}`))
      ).data() as Batch | undefined)
    : undefined;
  const activate = !!pending && Date.parse(pending.scheduledOpen) <= now;
  const batch = activate ? pending : current;
  const effective = activate
    ? {
        ...settings,
        currentBatchId: pending!.id,
        pendingBatchId: null,
        isFormOpen: null,
      }
    : settings;
  return {
    settings: effective,
    batch,
    open: orderingOpen(effective, batch, now),
    activate,
    current,
    commitActivation() {
      if (!activate || !batch) return;
      if (current && current.id !== batch.id)
        tx.update(adminDb.doc(`batches/${current.id}`), { status: "CLOSED" });
      tx.update(adminDb.doc(`batches/${batch.id}`), {
        status: orderingOpen(effective, batch, now) ? "OPEN" : "CLOSED",
      });
      tx.set(
        settingsRef,
        { currentBatchId: batch.id, pendingBatchId: null, isFormOpen: null },
        { merge: true },
      );
    },
  };
}
export async function publicOrdering() {
  return adminDb.runTransaction(async (tx) => {
    const state = await readOrdering(tx);
    state.commitActivation();
    return {
      isFormOpen: state.open,
      currentBatchId: state.batch?.id ?? null,
      nextPickupDate: state.batch?.pickupDate ?? "",
      scheduledOpen: state.batch?.scheduledOpen ?? "",
      scheduledClose: state.batch?.scheduledClose ?? "",
    };
  });
}
