import { newestPickupEvents, dateForPickup, pickupYear } from "./event-order";
import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  key,
  PickupError,
  clean,
  normalize,
  mergeSource,
  parseSheet,
  printerSchema,
  arrivalSchema,
  publicJob,
  type Registration,
  type Job,
  type PickupEvent,
} from "./model";
import { renderZpl_ } from "./label";
import {
  columnName,
  planDatedAttendance,
  sourceIdentity,
  DATED_HEADERS,
  LOOKUP_TAB,
  LOOKUP_VERSION,
  LOOKUP_HEADERS,
  ROW_KEY,
  LOOKUP_KEY,
  LOOKUP_ROW,
  rowFormulas,
  lookupTable,
  enteredCell,
} from "./dated-attendance";
import { sheets, tabs, values, sourceId, formulaSafe, quote } from "./google";
export const actionSchema = z
  .object({
    id: z.string().max(500),
    revision: z.number().int().positive(),
    action: z.enum(["checkin", "checkinOnly", "advance", "reprint"]),
    copies: z.number().int().min(1).max(3),
    token: z
      .string()
      .min(16)
      .max(80)
      .regex(/^[\w-]+$/),
    arrival: arrivalSchema.nullish(),
    reason: z.string().max(300).optional(),
    prepackedReason: z.enum(["noShow", "walkUp"]).nullish(),
  })
  .strict();
export type Action = z.infer<typeof actionSchema>;
export function printer() {
  let input: unknown;
  try {
    input = JSON.parse(process.env.PICKUP_PRINTER_CONFIG || "{}");
  } catch {
    throw new PickupError(503, "Printer configuration must be JSON.");
  }
  const parsed = printerSchema.safeParse(input);
  if (!parsed.success || !process.env.PRINTNODE_API_KEY)
    throw new PickupError(
      503,
      "Configure the PrintNode key and printer ID, DPI and label dimensions.",
    );
  return parsed.data;
}
const now = () => new Date().toISOString();
const REPORT_HEADERS = [
  "Registration ID",
  "Pickup Event ID",
  "Pickup Event",
  "Source Tab ID",
  "Source ID#",
  "Name",
  "Phone",
  "Household Size",
  "Attendance",
  "Checked In At (UTC)",
  "Previous No-Show",
  "Pickup Type",
  "Car Number",
  "Car Line",
  "Vehicle",
  "Needs Source Review",
  "Last Synced At (UTC)",
];
export class PickupStore {
  constructor(public db: Firestore) {}
  reg(id: string) {
    return this.db.doc(`pickupRegistrations/${key(id)}`);
  }
  job(id: string) {
    return this.db.doc(`pickupJobs/${id}`);
  }
  async events() {
    return newestPickupEvents(
      (await this.db.collection("pickupEvents").get()).docs
        .map((d) => {
          const event = d.data() as PickupEvent;
          return {
            ...event,
            pickupDate:
              event.pickupDate ||
              dateForPickup(
                event.sourceTitle || event.label,
                pickupYear(d.createTime.toDate()),
              ),
          };
        })
        .filter((e) => e.enabled),
      Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Denver",
          year: "numeric",
        }).format(new Date()),
      ),
    );
  }
  async event(id: string) {
    const event = (
      await this.db.doc(`pickupEvents/${key(id)}`).get()
    ).data() as PickupEvent | undefined;
    if (!event?.enabled)
      throw new PickupError(409, "Select an enabled pickup event.");
    return event;
  }
  async list(eventId: string) {
    await this.event(eventId);
    const [regs, jobs] = await Promise.all([
      this.db
        .collection("pickupRegistrations")
        .where("eventId", "==", eventId)
        .limit(1501)
        .get(),
      this.db
        .collection("pickupJobs")
        .where("eventId", "==", eventId)
        .limit(3001)
        .get(),
    ]);
    if (regs.size > 1500 || jobs.size > 3000)
      throw new PickupError(
        409,
        "Archive this event before exceeding 1,500 households or 3,000 print jobs.",
      );
    const all = jobs.docs.map((d) => d.data() as Job);
    return regs.docs
      .map((d) => d.data() as Registration)
      .filter((r) => !r.inactive)
      .map((r) => {
        const related = all
          .filter((j) => j.registrationId === r.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
          ...r,
          jobs: related.slice(0, 5).map(publicJob),
          lastJob: related[0] ? publicJob(related[0]) : null,
        };
      });
  }
  async action(request: Action, actor: string) {
    const arriving = ["checkin", "checkinOnly"].includes(request.action);
    if (arriving && !request.arrival)
      throw new PickupError(400, "Choose a line and enter the 3-digit number.");
    if (request.action === "reprint" && clean(request.reason).length < 5)
      throw new PickupError(
        400,
        "Enter a reprint reason of at least five characters.",
      );
    const profile = request.action === "checkinOnly" ? null : printer();
    const result = await this.db.runTransaction(async (tx) => {
      const rRef = this.reg(request.id),
        opRef = this.db.doc(`pickupRequests/${key(request.token)}`);
      const [rSnap, op] = await tx.getAll(rRef, opRef);
      const r = rSnap.data() as Registration | undefined;
      if (!r || r.inactive)
        throw new PickupError(
          404,
          "Registration no longer exists. Refresh the list.",
        );
      const event = (
        await tx.get(this.db.doc(`pickupEvents/${key(r.eventId)}`))
      ).data();
      if (!event?.enabled)
        throw new PickupError(409, "Pickup event is disabled.");
      const saved = op.data();
      if (saved) {
        if (saved.registrationId !== r.id || saved.action !== request.action)
          throw new PickupError(
            409,
            "Request token already used for another action.",
          );
        return {
          record: r,
          job: saved.jobId
            ? ((await tx.get(this.job(saved.jobId))).data() as Job)
            : null,
          reused: true,
        };
      }
      if (arriving && r.checkedInAt)
        return {
          record: r,
          job: r.arrivalJobId
            ? ((await tx.get(this.job(r.arrivalJobId))).data() as Job)
            : null,
          reused: true,
        };
      if (r.revision !== request.revision)
        throw new PickupError(
          409,
          "Registration changed. Refresh and review it.",
        );
      if (r.reviewRequired)
        throw new PickupError(
          409,
          "Coordinator review is required before check-in.",
        );
      if (request.action !== "checkinOnly" && r.errors.length)
        throw new PickupError(
          409,
          "Resolve source data marked Needs review before printing.",
        );
      const jobId =
        request.action === "checkin"
          ? key(r.id + ":arrival")
          : request.action === "advance"
            ? key(r.id + ":advance:" + r.revision)
            : key(request.token);
      const prior =
        request.action !== "checkinOnly"
          ? ((await tx.get(this.job(jobId))).data() as Job | undefined)
          : undefined;
      if (prior) return { record: r, job: prior, reused: true };
      const stamp = now();
      if (arriving && request.prepackedReason) {
        r.prepackedReason = request.prepackedReason;
        r.previousNoShow = request.prepackedReason === "noShow";
        r.pickupType = "prepacked";
      }
      const arrival = arriving
        ? request.arrival!
        : request.action === "reprint" && r.checkedInAt
          ? request.arrival || r.arrival || null
          : null;
      let job: Job | null = null;
      if (profile) {
        job = {
          id: jobId,
          registrationId: r.id,
          eventId: r.eventId,
          revision: r.revision,
          action: request.action,
          token: request.token,
          status: "Prepared",
          copies: request.copies,
          createdAt: stamp,
          actor,
          station: "Food packing station",
          printerId: profile.id,
          zpl: renderZpl_(r, profile, request.copies, arrival),
          arrival,
          prepackedReason: r.prepackedReason || null,
          reason: clean(request.reason),
        };
        tx.create(this.job(jobId), job);
      }
      if (arriving) {
        r.checkedInAt = stamp;
        r.checkedInBy = actor;
        r.arrival = arrival;
        if (job) r.arrivalJobId = job.id;
        tx.set(rRef, r);
        this.dirty(tx);
      } else if (request.action === "reprint" && r.checkedInAt && arrival) {
        r.arrival = arrival;
        tx.set(rRef, r);
        this.dirty(tx);
      }
      tx.create(opRef, {
        registrationId: r.id,
        action: request.action,
        jobId: job?.id || null,
        createdAt: stamp,
      });
      return { record: r, job, reused: false };
    });
    if (result.job?.status === "Prepared") await this.dispatch(result.job.id);
    const job = result.job
      ? ((await this.job(result.job.id).get()).data() as Job)
      : null;
    return {
      reused: result.reused,
      checkedInAt: result.record.checkedInAt || null,
      arrival: result.record.arrival || null,
      job: job ? publicJob(job) : null,
    };
  }
  dirty(tx: FirebaseFirestore.Transaction) {
    tx.set(
      this.db.doc("pickupSync/attendance"),
      { generation: FieldValue.increment(1), dirty: true },
      { merge: true },
    );
  }
  async addWalkIn(input: unknown, actor: string) {
    const q = z
      .object({
        eventId: z.string().max(100),
        name: z.string().trim().min(1).max(100),
        phone: z.string().max(40),
        householdSize: z.number().int().min(1).max(99),
        copies: z.number().int().min(1).max(3),
        token: z
          .string()
          .min(16)
          .max(70)
          .regex(/^[\w-]+$/),
        arrival: arrivalSchema,
        prepackedReason: z.enum(["noShow", "walkUp"]).optional(),
        print: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    const id = `walkin:${q.eventId}:${key(q.token)}`;
    await this.db.runTransaction(async (tx) => {
      const [existing, event] = await tx.getAll(
        this.reg(id),
        this.db.doc(`pickupEvents/${key(q.eventId)}`),
      );
      if (!event.data()?.enabled)
        throw new PickupError(409, "Select an enabled pickup event.");
      if (existing.exists) return;
      const r: Registration = {
        ...normalize({ ...q, phone: q.phone || "No phone" }),
        id,
        eventId: q.eventId,
        revision: 1,
        sourceKind: "walkin",
        walkIn: true,
        walkInToken: q.token,
        pickupType: "prepacked",
        prepackedReason: q.prepackedReason || "walkUp",
        previousNoShow: q.prepackedReason === "noShow",
      };
      tx.create(this.reg(id), r);
      this.dirty(tx);
    });
    const r = (await this.reg(id).get()).data() as Registration;
    return {
      id,
      ...(await this.action(
        {
          id,
          revision: r.revision,
          action: q.print === false ? "checkinOnly" : "checkin",
          copies: q.copies,
          token: q.token + "-arrive",
          arrival: q.arrival,
        },
        actor,
      )),
    };
  }
  async dispatch(id: string) {
    if (!process.env.PRINTNODE_API_KEY)
      throw new PickupError(
        503,
        "PrintNode is not configured; the saved job remains prepared.",
      );
    const claimed = await this.db.runTransaction(async (tx) => {
      const ref = this.job(id),
        job = (await tx.get(ref)).data() as Job | undefined;
      if (!job || job.status !== "Prepared") return null;
      if (
        !Number.isFinite(Date.parse(job.createdAt)) ||
        Date.now() - Date.parse(job.createdAt) > 120000
      ) {
        tx.update(ref, {
          status: "Failed",
          failureReason:
            "This unsent label request expired. Check the packing station and explicitly reprint if needed.",
        });
        return null;
      }
      const [rSnap, eSnap] = await tx.getAll(
        this.reg(job.registrationId),
        this.db.doc(`pickupEvents/${key(job.eventId)}`),
      );
      const r = rSnap.data() as Registration | undefined;
      if (
        !r ||
        r.inactive ||
        r.reviewRequired ||
        r.errors.length ||
        r.revision !== job.revision ||
        !eSnap.data()?.enabled
      ) {
        tx.update(ref, {
          status: "Failed",
          failureReason:
            "Source changed before dispatch. Review and explicitly reprint.",
        });
        return null;
      }
      tx.update(ref, { status: "Sending", sendingAt: now() });
      return job;
    });
    if (!claimed) return;
    let status = "Outcome unknown",
      providerId: string | null = null,
      failureReason: string | null =
        "Dispatch outcome is uncertain. Check the printer before explicitly reprinting.";
    try {
      const response = await fetch("https://api.printnode.com/printjobs", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(process.env.PRINTNODE_API_KEY + ":").toString("base64"),
          "Content-Type": "application/json",
          "X-Idempotency-Key": claimed.id,
        },
        body: JSON.stringify({
          printerId: claimed.printerId,
          contentType: "raw_base64",
          content: Buffer.from(claimed.zpl).toString("base64"),
          title: "FRFS pickup " + claimed.id,
          source: "FRFS hosted pickup",
          qty: 1,
          expireAfter: 120,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 201) {
        const body = await response.json();
        if (Number.isSafeInteger(body) && body > 0) {
          status = "Submitted";
          providerId = String(body);
          failureReason = null;
        }
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 409
      ) {
        status = "Failed";
        failureReason =
          "Print service rejected this job. Check configuration before reprinting.";
      }
    } catch {
      /* Ambiguous dispatch stays unknown, never automatically retried. */
    }
    await this.db.runTransaction(async (tx) => {
      const ref = this.job(id),
        current = (await tx.get(ref)).data();
      tx.update(ref, {
        status: current?.confirmedAt ? "Confirmed by staff" : status,
        providerId,
        failureReason,
      });
    });
  }
  async checkPrintStatus(id: string) {
    const ref = this.job(id),
      j = (await ref.get()).data() as Job | undefined;
    if (!j) throw new PickupError(404, "Print job not found.");
    if (!j.providerId || !/^\d+$/.test(j.providerId))
      throw new PickupError(
        409,
        "No service job ID is available. Check the printer before reprinting.",
      );
    if (
      j.providerCheckedAt &&
      Date.now() - Date.parse(j.providerCheckedAt) < 15000
    )
      return publicJob(j);
    if (!process.env.PRINTNODE_API_KEY)
      throw new PickupError(503, "PrintNode is not configured.");
    const response = await fetch(
      `https://api.printnode.com/printjobs/${j.providerId}/states`,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(process.env.PRINTNODE_API_KEY + ":").toString("base64"),
        },
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw new PickupError(
        503,
        "Could not check print service. No labels were resent.",
      );
    const states = (await response.json()) as {
      state: string;
      createTimestamp?: string;
    }[];
    if (!Array.isArray(states))
      throw new PickupError(503, "Unexpected print service response.");
    const last = states
      .flat()
      .filter(
        (s) =>
          String((s as { printJobId?: number }).printJobId) === j.providerId &&
          Number.isFinite(Date.parse(s.createTimestamp || "")),
      )
      .sort((a, b) =>
        String(b.createTimestamp).localeCompare(String(a.createTimestamp)),
      )[0];
    const change = {
      providerState: last?.state || "unknown",
      providerCheckedAt: now(),
    };
    await ref.update(change);
    return publicJob({ ...j, ...change });
  }
  async confirmPrinted(id: string) {
    const ref = this.job(id);
    return this.db.runTransaction(async (tx) => {
      const j = (await tx.get(ref)).data() as Job | undefined;
      if (!j) throw new PickupError(404, "Job not found.");
      if (j.status === "Prepared")
        throw new PickupError(409, "This job has never been sent.");
      const changes = { status: "Confirmed by staff", confirmedAt: now() };
      tx.update(ref, changes);
      return publicJob({ ...j, ...changes });
    });
  }
  async resumePrint(id: string) {
    const j = (await this.job(id).get()).data() as Job | undefined;
    if (!j || j.status !== "Prepared")
      throw new PickupError(
        409,
        "Only a never-dispatched prepared job can resume.",
      );
    await this.dispatch(id);
    return publicJob((await this.job(id).get()).data() as Job);
  }
  async configureEvent(input: unknown) {
    const q = z
      .object({
        sourceSheetId: z.number().int().nonnegative(),
        label: z.string().trim().min(3).max(100),
        configVersion: z.string(),
      })
      .parse(input);
    const found = (await tabs()).find((t) => t.sheetId === q.sourceSheetId);
    if (!found || ["FRFS Attendance", LOOKUP_TAB].includes(found.title))
      throw new PickupError(409, "Choose a source pickup tab.");
    const event: PickupEvent = {
      id: `sheet-${q.sourceSheetId}`,
      label: q.label,
      sourceTitle: found.title,
      sourceSheetId: q.sourceSheetId,
      enabled: true,
    };
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc("pickupSettings/config"),
        config = (await tx.get(ref)).data();
      const eventRef = this.db.doc(`pickupEvents/${key(event.id)}`);
      const prior = await tx.get(eventRef);
      const pickupDate =
        prior.data()?.pickupDate ||
        dateForPickup(
          found.title,
          pickupYear(prior.createTime?.toDate() || new Date()),
        );
      if (pickupDate) event.pickupDate = pickupDate;
      if (String(config?.version || 0) !== q.configVersion)
        throw new PickupError(
          409,
          "Setup changed in another session. Reload before saving.",
        );
      tx.set(this.db.doc(`pickupEvents/${key(event.id)}`), event, {
        merge: true,
      });
      tx.set(ref, { version: (config?.version || 0) + 1 });
    });
    return {
      eventId: event.id,
      message:
        "Pickup enabled. Preview and refresh source data to import households.",
    };
  }
  async preview() {
    const available = await tabs();
    return Promise.all(
      (await this.events()).map(async (event) => {
        const tab = available.find((t) => t.sheetId === event.sourceSheetId);
        if (!tab) throw new PickupError(409, "Source pickup tab is missing.");
        if (tab.rows > 2500 || tab.columns > 100)
          throw new PickupError(
            409,
            "Pilot source limit: 2,500 grid rows and 100 columns per tab.",
          );
        const endColumn =
          tab.columns <= 26
            ? String.fromCharCode(64 + tab.columns)
            : String.fromCharCode(64 + Math.floor((tab.columns - 1) / 26)) +
              String.fromCharCode(65 + ((tab.columns - 1) % 26));
        const header = (await values(tab.title, `A1:${endColumn}1`))[0] || [];
        const rows =
          tab.rows > 1
            ? await values(
                tab.title,
                `A2:${endColumn}${Math.min(2500, tab.rows)}`,
              )
            : [];
        const parsed = parseSheet(header, rows);
        return {
          event,
          parsed,
          eventId: event.id,
          eventLabel: event.label,
          tabTitle: tab.title,
          sourceRows: parsed.sourceRows,
          lastListRow: parsed.lastListRow,
          ignoredAfterList: parsed.ignoredAfterList,
          assumedDateColumn: parsed.assumedDateColumn,
          households: parsed.groups.size,
          duplicateGroups: [...parsed.groups.values()].filter(
            (g) => g.length > 1,
          ).length,
        };
      }),
    );
  }
  async importSource() {
    return this.withLease("import", async () => {
      const parts = await this.preview();
      if (parts.reduce((n, p) => n + p.households, 0) > 1500)
        throw new PickupError(
          409,
          "Import at most 1,500 households across enabled events.",
        );
      // Every Google read/header check completes before any registration is changed.
      let imported = 0,
        needsReview = 0;
      for (const p of parts) {
        const existing = await this.db
          .collection("pickupRegistrations")
          .where("eventId", "==", p.event.id)
          .get();
        if (
          !p.sourceRows &&
          existing.docs.some(
            (d) => d.data().sourceKind === "sheets" && !d.data().inactive,
          )
        )
          throw new PickupError(
            409,
            "A previously populated tab is empty. Review it before importing.",
          );
      }
      for (const p of parts) {
        const existing = await this.db
          .collection("pickupRegistrations")
          .where("eventId", "==", p.event.id)
          .get();
        const seen = new Set<string>();
        for (const [externalId, candidates] of p.parsed.groups) {
          const id = `sheet:${sourceId()}:${p.event.sourceSheetId}:${encodeURIComponent(externalId)}`;
          seen.add(id);
          await this.db.runTransaction(async (tx) => {
            const ref = this.reg(id),
              old = (await tx.get(ref)).data() as Registration | undefined;
            const r = mergeSource(
              sourceId(),
              p.event,
              externalId,
              candidates,
              old,
            );
            tx.set(ref, r);
            this.dirty(tx);
            if (r.errors.length) needsReview++;
          });
          imported++;
        }
        for (const doc of existing.docs) {
          const old = doc.data() as Registration;
          if (old.sourceKind !== "sheets" || seen.has(old.id)) continue;
          await this.db.runTransaction(async (tx) => {
            const r = (await tx.get(doc.ref)).data() as Registration;
            if (r.checkedInAt)
              tx.update(doc.ref, {
                sourceMissing: true,
                reviewRequired: true,
                errors: [
                  "Arrived household removed from source. Coordinator review required.",
                ],
                revision: r.revision + (r.sourceMissing ? 0 : 1),
              });
            else tx.update(doc.ref, { inactive: true });
            this.dirty(tx);
          });
        }
      }
      const lastSync = now();
      await this.db.doc("pickupSync/import").set({ lastSync }, { merge: true });
      return {
        imported,
        needsReview,
        unassigned: 0,
        ignoredAfterList: parts.reduce((n, p) => n + p.ignoredAfterList, 0),
        lastSync,
      };
    });
  }
  async resolveDuplicate(input: unknown, actor: string) {
    const q = z
      .object({
        id: z.string(),
        revision: z.number().int(),
        groupKey: z.string(),
        candidateKey: z.string(),
        reason: z.string().trim().min(5).max(300),
      })
      .parse(input);
    return this.db.runTransaction(async (tx) => {
      const ref = this.reg(q.id),
        r = (await tx.get(ref)).data() as Registration | undefined;
      if (
        !r ||
        r.inactive ||
        r.sourceMissing ||
        r.revision !== q.revision ||
        r.groupKey !== q.groupKey
      )
        throw new PickupError(
          409,
          "Responses changed; refresh before reviewing.",
        );
      const candidate = r.duplicateCandidates?.find(
        (c) => c.key === q.candidateKey,
      );
      if (!candidate || candidate.errors.length)
        throw new PickupError(409, "Choose a response with valid fields.");
      const decision = {
        groupKey: q.groupKey,
        candidateKey: q.candidateKey,
        reason: q.reason,
        actor,
        reviewedAt: now(),
      };
      const { name, phone, phoneSearch, householdSize, errors } = candidate;
      tx.update(ref, {
        name,
        phone,
        phoneSearch,
        householdSize,
        errors,
        sourceSubmittedAt: candidate.submittedAt,
        sourceRow: candidate.sourceRow,
        duplicateReview: decision,
        reviewRequired: false,
        revision: r.revision + 1,
      });
      tx.create(this.db.collection("pickupAudit").doc(), {
        type: "duplicate-review",
        registrationId: r.id,
        ...decision,
      });
      this.dirty(tx);
      return { message: "Response selected. Nothing was printed." };
    });
  }
  async withLease<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const owner = randomUUID(),
      ref = this.db.doc(`pickupSync/${name}`);
    await this.db.runTransaction(async (tx) => {
      const d = (await tx.get(ref)).data();
      if (d?.leaseUntil > Date.now())
        throw new PickupError(
          409,
          "This sync is already running. Retry shortly.",
        );
      tx.set(
        ref,
        { leaseOwner: owner, leaseUntil: Date.now() + 10 * 60000 },
        { merge: true },
      );
    });
    try {
      return await fn();
    } finally {
      await this.db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).data()?.leaseOwner === owner)
          tx.update(ref, { leaseUntil: 0 });
      });
    }
  }
  async exportAttendance() {
    return this.withLease("export", async () => {
      // Capture generation BEFORE the snapshot: any later arrival must leave dirty set.
      const syncRef = this.db.doc("pickupSync/attendance"),
        generation = (await syncRef.get()).data()?.generation || 0;
      const [all, eventDocs] = await Promise.all([
        this.db.collection("pickupRegistrations").limit(10001).get(),
        this.db.collection("pickupEvents").get(),
      ]);
      if (all.size > 10000)
        throw new PickupError(
          409,
          "Archive before exporting over 10,000 records.",
        );
      if (!all.size)
        throw new PickupError(
          409,
          "Import registrations before exporting attendance.",
        );
      const titles = await tabs();
      let destination = titles.find((t) => t.title === "FRFS Attendance");
      if (!destination) {
        const created = await sheets(":batchUpdate", "POST", {
          requests: [
            {
              addSheet: {
                properties: {
                  title: "FRFS Attendance",
                  gridProperties: { rowCount: 1000, columnCount: 17 },
                },
              },
            },
          ],
        });
        const properties = created.replies?.[0]?.addSheet?.properties;
        if (!Number.isInteger(properties?.sheetId))
          throw new PickupError(
            503,
            "Google did not confirm the attendance tab. Retry the export.",
          );
        destination = {
          sheetId: properties.sheetId,
          title: "FRFS Attendance",
          rows: properties.gridProperties?.rowCount || 1000,
          columns: properties.gridProperties?.columnCount || 17,
        };
      }
      const prior = await values(
        "FRFS Attendance",
        `A1:Q${Math.min(destination.rows, 10002)}`,
      );
      if (prior.length > 10001)
        throw new PickupError(
          409,
          "Attendance history exceeds 10,000 records.",
        );
      if (
        prior.length &&
        JSON.stringify(prior[0]) !== JSON.stringify(REPORT_HEADERS)
      )
        throw new PickupError(
          409,
          "FRFS Attendance has different headers; no attendance rows were changed.",
        );
      const rows = new Map<string, unknown[]>();
      for (const row of prior.slice(1)) {
        if (!row[0]) continue;
        if (rows.has(String(row[0])))
          throw new PickupError(
            409,
            "Duplicate IDs in attendance history. Review before export.",
          );
        rows.set(String(row[0]), row);
      }
      const events = eventDocs.docs.map((d) => d.data() as PickupEvent),
        stamp = now();
      for (const doc of all.docs) {
        const r = doc.data() as Registration;
        if (r.inactive && !r.checkedInAt) continue;
        rows.set(
          r.id,
          [
            r.id,
            r.eventId,
            events.find((e) => e.id === r.eventId)?.label || r.eventId,
            r.sourceSheetId ?? "",
            r.externalId || "",
            r.name,
            r.phone,
            r.householdSize,
            r.checkedInAt ? "Arrived" : "Expected",
            r.checkedInAt || "",
            r.previousNoShow || r.prepackedReason === "noShow" ? "Yes" : "No",
            r.pickupType === "prepacked"
              ? r.prepackedReason === "noShow"
                ? "Pre-Packed / Previous No-Show"
                : "Pre-Packed / Walk Up"
              : "Registered",
            r.arrival?.number || "",
            r.arrival?.line || "",
            r.arrival?.vehicle || "",
            r.reviewRequired || r.errors.length ? "Yes" : "No",
            stamp,
          ].map(formulaSafe),
        );
      }
      if (rows.size > 10000)
        throw new PickupError(409, "Attendance export exceeds 10,000 records.");
      if (
        destination.rows < rows.size + 1 ||
        destination.columns < REPORT_HEADERS.length
      )
        await sheets(":batchUpdate", "POST", {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: destination.sheetId,
                  gridProperties: {
                    rowCount: Math.max(destination.rows, rows.size + 1),
                    columnCount: Math.max(
                      destination.columns,
                      REPORT_HEADERS.length,
                    ),
                  },
                },
                fields: "gridProperties(rowCount,columnCount)",
              },
            },
          ],
        });
      // RAW input prevents formulas; all existing history rows are retained.
      await sheets(
        "/values/" +
          encodeURIComponent(quote("FRFS Attendance") + "!A1") +
          "?valueInputOption=RAW",
        "PUT",
        { values: [REPORT_HEADERS, ...rows.values()] },
      );
      const dated = await this.exportDatedAttendance(
        all.docs
          .map((d) => d.data() as Registration)
          .filter((r) => !r.inactive || r.checkedInAt),
        events,
        stamp,
      );
      await this.db.runTransaction(async (tx) => {
        const current = (await tx.get(syncRef)).data();
        tx.set(
          syncRef,
          {
            lastSync: stamp,
            lookupVersion: LOOKUP_VERSION,
            lastError: dated.retryRequired ? dated.warnings.join(" ") : null,
            lastWarning: dated.warnings.join(" ") || null,
            dirty:
              (current?.generation || 0) !== generation || dated.retryRequired,
          },
          { merge: true },
        );
      });
      return {
        rows: rows.size,
        lastSync: stamp,
        message: `Attendance saved to ${dated.tabs} dated pickup tab(s): ${dated.matched} response rows and ${dated.walkUps} walk-ups. FRFS Attendance summary also updated.${dated.warnings.length ? " " + dated.warnings.join(" ") : ""}`,
        dated,
      };
    });
  }
  async exportDatedAttendance(
    records: Registration[],
    events: PickupEvent[],
    stamp: string,
  ) {
    const available = await tabs(),
      plans = [],
      warnings: string[] = [];
    let retryRequired = false;
    for (const event of events) {
      const group = records.filter((r) => r.eventId === event.id);
      if (!group.length) continue;
      const tab = available.find((t) => t.sheetId === event.sourceSheetId);
      if (!tab) {
        warnings.push(
          `Source tab missing for ${event.label}; its history is retained in FRFS Attendance.`,
        );
        if (event.enabled) retryRequired = true;
        continue;
      }
      if (["FRFS Attendance", LOOKUP_TAB].includes(tab.title))
        throw new PickupError(
          409,
          "Choose an original dated response tab for attendance.",
        );
      if (tab.rows > 2500 || tab.columns > 100)
        throw new PickupError(
          409,
          "Dated attendance sync supports up to 2,500 rows and 100 columns per tab.",
        );
      if (
        group.some(
          (r) => r.sourceKind === "sheets" && r.sourceSheetId !== tab.sheetId,
        )
      )
        throw new PickupError(
          409,
          "Registration and event source tabs do not match. Review the event mapping.",
        );
      const range = `A1:${columnName(tab.columns - 1)}${tab.rows}`;
      const grid = await values(tab.title, range);
      const plan = planDatedAttendance(
        tab.title,
        grid,
        group,
        stamp,
        tab.sheetId,
      );
      // Reject a concurrent source edit/sort before writing. Never trust imported row numbers.
      if (
        sourceIdentity(await values(tab.title, range), plan.column) !==
        plan.sourceIdentity
      )
        throw new PickupError(
          409,
          `Source rows changed in ${tab.title} during sync. Retry after the edit/sort finishes.`,
        );
      plans.push({ tab, plan, headers: grid[0] || [] });
    }
    let ledgerTab = available.find((t) => t.title === LOOKUP_TAB);
    if (!ledgerTab) {
      const created = await sheets(":batchUpdate", "POST", {
        requests: [
          {
            addSheet: {
              properties: {
                title: LOOKUP_TAB,
                hidden: true,
                gridProperties: {
                  rowCount: 10002,
                  columnCount: LOOKUP_HEADERS.length,
                },
              },
            },
          },
        ],
      });
      const sheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
      if (!Number.isInteger(sheetId))
        throw new PickupError(
          503,
          "Google did not confirm the attendance lookup tab.",
        );
      ledgerTab = {
        sheetId,
        title: LOOKUP_TAB,
        rows: 10002,
        columns: LOOKUP_HEADERS.length,
      };
    } else {
      const header = (await values(LOOKUP_TAB, `A1:S1`))[0] || [];
      if (
        header.length &&
        JSON.stringify(header) !== JSON.stringify(LOOKUP_HEADERS)
      )
        throw new PickupError(
          409,
          "The attendance data tab has incompatible headers; no dated attendance was changed.",
        );
    }
    const ledger = lookupTable(plans.map((p) => p.plan));
    if (ledger.length > 10002)
      throw new PickupError(409, "Attendance lookup exceeds 10,000 rows.");
    const requests: object[] = [];
    if (
      ledger.length > ledgerTab.rows ||
      ledgerTab.columns < LOOKUP_HEADERS.length
    )
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: ledgerTab.sheetId,
            gridProperties: {
              rowCount: Math.max(ledgerTab.rows, ledger.length),
              columnCount: Math.max(ledgerTab.columns, LOOKUP_HEADERS.length),
            },
          },
          fields: "gridProperties(rowCount,columnCount)",
        },
      });
    // Clear old ledger values in this same atomic batch, preventing stale entries from winning a lookup.
    requests.push({
      repeatCell: {
        range: {
          sheetId: ledgerTab.sheetId,
          startRowIndex: 0,
          endRowIndex: Math.max(ledgerTab.rows, ledger.length),
          startColumnIndex: 0,
          endColumnIndex: LOOKUP_HEADERS.length,
        },
        cell: {},
        fields: "userEnteredValue",
      },
    });
    requests.push({
      updateCells: {
        start: { sheetId: ledgerTab.sheetId, rowIndex: 0, columnIndex: 0 },
        rows: ledger.map((row, i) => ({
          values: row.map((value, j) =>
            enteredCell(
              value,
              i > 0 && j === 0 && String(value).startsWith("="),
            ),
          ),
        })),
        fields: "userEnteredValue",
      },
    });
    for (const { tab, plan, headers } of plans) {
      if (plan.columns > tab.columns)
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: tab.sheetId,
              gridProperties: { columnCount: plan.columns },
            },
            fields: "gridProperties.columnCount",
          },
        });
      // Capture legacy walk-up identities at their CURRENT rows atomically before replacing old values.
      if (plan.migrateKeys && plan.rows > 1)
        requests.push({
          copyPaste: {
            source: {
              sheetId: tab.sheetId,
              startRowIndex: 1,
              endRowIndex: plan.rows,
              startColumnIndex: plan.column + 11,
              endColumnIndex: plan.column + 12,
            },
            destination: {
              sheetId: tab.sheetId,
              startRowIndex: 1,
              endRowIndex: plan.rows,
              startColumnIndex: plan.keyColumn,
              endColumnIndex: plan.keyColumn + 1,
            },
            pasteType: "PASTE_VALUES",
          },
        });
      const write = (
        column: number,
        row: number,
        rows: unknown[][],
        formulas = false,
      ) =>
        requests.push({
          updateCells: {
            start: { sheetId: tab.sheetId, rowIndex: row, columnIndex: column },
            rows: rows.map((r) => ({
              values: r.map((v) => enteredCell(v, formulas)),
            })),
            fields: "userEnteredValue",
          },
        });
      write(plan.column, 0, [DATED_HEADERS]);
      write(plan.keyColumn, 0, [[ROW_KEY]]);
      write(plan.lookupColumn, 0, [[LOOKUP_KEY]]);
      write(plan.rowColumn, 0, [[LOOKUP_ROW]]);
      for (const index of [plan.keyColumn, plan.lookupColumn, plan.rowColumn])
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId: tab.sheetId,
              dimension: "COLUMNS",
              startIndex: index,
              endIndex: index + 1,
            },
            properties: { hiddenByUser: true },
            fields: "hiddenByUser",
          },
        });
      const formulas = rowFormulas(plan, headers, tab.sheetId, ledger.length);
      write(
        plan.column,
        1,
        Array.from({ length: plan.rows - 1 }, () => formulas.fields),
        true,
      );
      write(
        plan.lookupColumn,
        1,
        Array.from({ length: plan.rows - 1 }, () => [formulas.lookup]),
        true,
      );
      write(
        plan.rowColumn,
        1,
        Array.from({ length: plan.rows - 1 }, () => [formulas.lookupRow]),
        true,
      );
      if (plan.appendWalkUps.length) {
        const rows = plan.appendWalkUps.map((r) => {
          const cells: object[] = Array.from(
            { length: plan.columns },
            () => ({}),
          );
          formulas.fields.forEach((formula, i) => {
            cells[plan.column + i] = enteredCell(formula, true);
          });
          cells[plan.keyColumn] = enteredCell(r.id);
          cells[plan.lookupColumn] = enteredCell(formulas.lookup, true);
          cells[plan.rowColumn] = enteredCell(formulas.lookupRow, true);
          return { values: cells };
        });
        // appendCells allocates new rows on Google's side; a concurrent sort cannot overwrite another family.
        requests.push({
          appendCells: {
            sheetId: tab.sheetId,
            rows,
            fields: "userEnteredValue",
          },
        });
      }
    }
    await sheets(":batchUpdate", "POST", { requests });
    // A change while the request was in flight must leave export dirty for a fresh retry.
    for (const { tab, plan } of plans) {
      const grid = await values(
        tab.title,
        `A1:${columnName(Math.max(tab.columns, plan.columns) - 1)}${Math.max(tab.rows, plan.rows)}`,
      );
      if (sourceIdentity(grid, plan.column) !== plan.sourceIdentity)
        throw new PickupError(
          409,
          `Source rows changed in ${tab.title} during sync. Attendance will retry; avoid sorting during the export.`,
        );
    }
    return {
      tabs: plans.length,
      warnings,
      retryRequired,
      matched: plans.reduce((n, p) => n + p.plan.matched, 0),
      walkUps: plans.reduce((n, p) => n + p.plan.walkUps, 0),
    };
  }
  async worker() {
    const prepared = await this.db
      .collection("pickupJobs")
      .where("status", "==", "Prepared")
      .limit(5)
      .get();
    for (const doc of prepared.docs) await this.dispatch(doc.id);
    return { prepared: prepared.size, attendance: await this.syncAttendance() };
  }
  async syncAttendance() {
    const ref = this.db.doc("pickupSync/attendance");
    const sync = (await ref.get()).data();
    if (sync?.enabled === false) return "not pending";
    const upgrading = sync?.lookupVersion !== LOOKUP_VERSION;
    if (!sync?.dirty && !upgrading) return "not pending";
    // Batch busy car-line arrivals; list refreshes/worker retry the retained dirty flag.
    if (
      !upgrading &&
      sync?.lastSync &&
      Date.now() - Date.parse(sync.lastSync) < 30000
    )
      return "waiting for next refresh";
    try {
      // A second pass catches arrivals made while the first snapshot was exporting.
      for (let attempt = 0; attempt < 2; attempt++) {
        await this.exportAttendance();
        if (!(await ref.get()).data()?.dirty) break;
      }
      return (await ref.get()).data()?.dirty ? "retry pending" : "synced";
    } catch (error) {
      if (
        error instanceof PickupError &&
        error.status === 409 &&
        error.message.includes("already running")
      )
        return "sync in progress";
      await ref.set(
        {
          lastError:
            error instanceof PickupError
              ? error.message
              : "Attendance export failed; check workbook access and retry.",
          dirty: true,
        },
        { merge: true },
      );
      return "retry pending";
    }
  }
}
