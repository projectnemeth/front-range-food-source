/** Dry run by default. Run with --apply only during a verified ordering pause. */
import { adminDb } from "../src/lib/firebase-admin";
import {
  normalizedPhone,
  normalize,
  reservationId,
} from "../src/lib/server/profiles";
import { readFileSync, writeFileSync } from "node:fs";
import { validDate } from "../src/lib/dates";
async function main() {
  const option = (name: string) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const batchFile = option("--batches");
  const batchMapping: Record<
    string,
    { pickupDate: string; scheduledOpen: string; scheduledClose: string }
  > = batchFile ? JSON.parse(readFileSync(batchFile, "utf8")) : {};
  for (const [id, value] of Object.entries(batchMapping)) {
    if (
      !id ||
      id.includes("/") ||
      !validDate(value.pickupDate) ||
      !!value.scheduledOpen !== !!value.scheduledClose ||
      (value.scheduledOpen &&
        (!/Z$/.test(value.scheduledOpen) ||
          !/Z$/.test(value.scheduledClose) ||
          !Number.isFinite(Date.parse(value.scheduledOpen)) ||
          !Number.isFinite(Date.parse(value.scheduledClose)) ||
          Date.parse(value.scheduledOpen) >= Date.parse(value.scheduledClose)))
    )
      throw new Error("Invalid approved batch mapping");
  }
  const dispositionFile = option("--dispositions");
  type Reservation = { uid?: string; orderId?: string };
  const dispositions: Record<string, Reservation> = dispositionFile
    ? JSON.parse(readFileSync(dispositionFile, "utf8"))
    : {};
  const candidates = new Map<string, Reservation[]>();
  const apply = process.argv.includes("--apply");
  if (apply && process.env.ORDERING_PAUSED !== "true")
    throw new Error("Confirm ORDERING_PAUSED=true before applying");
  const users = await adminDb.collection("users").get();
  const orders = await adminDb.collection("orders").get();
  const targets = new Map<string, { uid?: string; orderId?: string }>();
  const conflicts: string[] = [];
  const missingProfiles: string[] = [];
  const missingOrders: string[] = [];
  function add(path: string, value: Reservation) {
    const choices = candidates.get(path) ?? [];
    if (!choices.some((v) => JSON.stringify(v) === JSON.stringify(value)))
      choices.push(value);
    candidates.set(path, choices);
    targets.set(path, choices[0]);
  }
  let incomplete = 0,
    missingBatch = 0,
    invalidDates = 0;
  for (const doc of users.docs) {
    const data = doc.data();
    if (
      !data.phone ||
      !data.address ||
      !data.firstName ||
      !data.lastName ||
      !data.foodBankId ||
      !data.familySize
    ) {
      incomplete++;
      missingProfiles.push(doc.id);
    }
    const values = {
      phone: normalizedPhone(data.phone || ""),
      address: normalize(data.address || ""),
      foodBankId: normalize(data.foodBankId || ""),
      name:
        data.firstName && data.lastName
          ? normalize(`${data.firstName} ${data.lastName}`)
          : "",
    };
    for (const [kind, value] of Object.entries(values))
      if (value)
        add(`profileReservations/${reservationId(kind, value)}`, {
          uid: doc.id,
        });
  }
  for (const doc of orders.docs) {
    const data = doc.data();
    if (
      !/^[\w-]{1,150}$/.test(data.batchId || "") ||
      !data.userId ||
      data.userId.includes("/")
    ) {
      missingBatch++;
      missingOrders.push(doc.id);
      continue;
    }
    if (!data.pickupDate || !validDate(data.pickupDate)) invalidDates++;
    add(`orderReservations/${data.batchId}/users/${data.userId}`, {
      orderId: doc.id,
    });
  }
  for (const [path, choices] of candidates) {
    const disposition = dispositions[path];
    if (disposition) {
      if (
        !choices.some((v) => JSON.stringify(v) === JSON.stringify(disposition))
      )
        throw new Error("Disposition does not identify an existing candidate");
      targets.set(path, disposition);
    } else if (choices.length > 1) conflicts.push(path);
  }
  for (const path of Object.keys(dispositions))
    if (!candidates.has(path)) throw new Error("Unknown disposition path");
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        users: users.size,
        orders: orders.size,
        reservations: targets.size,
        incompleteProfiles: incomplete,
        ordersMissingBatch: missingBatch,
        invalidDates,
        conflictingReservationCount: conflicts.length,
      },
      null,
      2,
    ),
  );
  const report = option("--report");
  if (report)
    writeFileSync(
      report,
      JSON.stringify(
        {
          conflicts: conflicts.map((path) => ({
            path,
            candidates: candidates.get(path),
          })),
          missingProfiles,
          missingOrders,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  if (conflicts.length) {
    console.error(
      "Reservation conflicts require administrator disposition; no records changed.",
    );
    process.exitCode = 1;
  } else if (apply) {
    const settings = (await adminDb.doc("settings/global").get()).data();
    if (settings?.isFormOpen !== false)
      throw new Error("Database settings must explicitly close ordering");
    for (const [id, value] of Object.entries(batchMapping))
      await adminDb.runTransaction(async (tx) => {
        const ref = adminDb.doc(`batches/${id}`);
        const old = await tx.get(ref);
        if (!old.exists) throw new Error("Mapped batch does not exist");
        tx.update(ref, { ...value, id });
      });
    // Only an explicit validated disposition can change an existing reservation. Original orders and profiles are preserved.
    for (const [path, value] of targets)
      await adminDb.runTransaction(async (tx) => {
        const ref = adminDb.doc(path);
        const old = await tx.get(ref);
        if (old.exists) {
          if (JSON.stringify(old.data()) !== JSON.stringify(value)) {
            if (dispositions[path]) tx.set(ref, value);
            else
              throw new Error("Existing reservation differs; abort migration");
          }
        } else tx.create(ref, value);
      });
    console.log(
      "Reservation backfill complete. Rerun dry-run and compare counts before reopening.",
    );
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  })
  .finally(() => adminDb.terminate());
