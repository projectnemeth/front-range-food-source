import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { administrator, failure, json, HttpError } from "@/lib/server/http";
import { readOrdering } from "@/lib/server/batches";
import { dateSchema } from "@/lib/schemas";
import { denverInstant, orderingOpen } from "@/lib/dates";
const schema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("toggle"), isFormOpen: z.boolean().nullable() })
    .strict(),
  z
    .object({
      action: z.literal("create"),
      pickupDate: dateSchema,
      scheduledOpen: z.string().max(30),
      scheduledClose: z.string().max(30),
      openOffset: z
        .string()
        .regex(/^[+-]\d{2}:\d{2}$/)
        .optional(),
      closeOffset: z
        .string()
        .regex(/^[+-]\d{2}:\d{2}$/)
        .optional(),
    })
    .strict(),
]);
export async function GET(request: Request) {
  try {
    await administrator(request);
    return NextResponse.json(
      await adminDb.runTransaction(async (tx) => {
        const state = await readOrdering(tx);
        const pending = state.settings.pendingBatchId
          ? (
              await tx.get(
                adminDb.doc(`batches/${state.settings.pendingBatchId}`),
              )
            ).data()
          : null;
        state.commitActivation();
        return {
          ...state.settings,
          activeBatch: state.batch ?? null,
          pendingBatch: pending,
        };
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    await administrator(request);
    const data = schema.parse(await json(request));
    let open = "",
      close = "";
    if (data.action === "create") {
      if (!!data.scheduledOpen !== !!data.scheduledClose)
        throw new HttpError(400, "invalidSchedule");
      if (data.scheduledOpen) {
        try {
          open = denverInstant(data.scheduledOpen, data.openOffset);
          close = denverInstant(data.scheduledClose, data.closeOffset);
        } catch {
          throw new HttpError(400, "ambiguousSchedule");
        }
        if (
          Date.parse(open) >= Date.parse(close) ||
          Date.parse(close) <= Date.now()
        )
          throw new HttpError(400, "invalidSchedule");
      }
    }
    await adminDb.runTransaction(async (tx) => {
      const state = await readOrdering(tx);
      const global = adminDb.doc("settings/global");
      if (data.action === "toggle") {
        if (!state.batch?.pickupDate) throw new HttpError(409, "missingBatch");
        state.commitActivation();
        tx.set(global, { isFormOpen: data.isFormOpen }, { merge: true });
        tx.update(adminDb.doc(`batches/${state.batch.id}`), {
          status: orderingOpen({ isFormOpen: data.isFormOpen }, state.batch)
            ? "OPEN"
            : "CLOSED",
        });
        return;
      }
      const id = `BATCH_${randomUUID()}`;
      const future = !!open && Date.parse(open) > Date.now();
      const batch = {
        id,
        name: `Pickup ${data.pickupDate}`,
        pickupDate: data.pickupDate,
        scheduledOpen: open,
        scheduledClose: close,
        status: future ? "SCHEDULED" : "OPEN",
        createdAt: new Date().toISOString(),
      };
      // Stable request key makes retries of the same schedule idempotent.
      const key = `${data.pickupDate}_${open || "MANUAL"}`.replace(
        /[^\w-]/g,
        "-",
      );
      const requestRef = adminDb.doc(`batchRequests/${key}`);
      if ((await tx.get(requestRef)).exists) return;
      if (state.settings.pendingBatchId)
        throw new HttpError(409, "scheduleExists");
      if (!future && state.open) throw new HttpError(409, "closeCurrentBatch");
      if (
        future &&
        state.batch &&
        state.open &&
        (state.settings.isFormOpen === true ||
          !state.batch.scheduledClose ||
          Date.parse(state.batch.scheduledClose) > Date.parse(open))
      )
        throw new HttpError(409, "overlappingSchedule");
      state.commitActivation();
      tx.create(adminDb.doc(`batches/${id}`), batch);
      tx.create(requestRef, { batchId: id });
      if (future) tx.set(global, { pendingBatchId: id }, { merge: true });
      else {
        if (state.batch)
          tx.update(adminDb.doc(`batches/${state.batch.id}`), {
            status: "CLOSED",
          });
        tx.set(
          global,
          { currentBatchId: id, isFormOpen: open ? null : true },
          { merge: true },
        );
      }
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return failure(e);
  }
}
