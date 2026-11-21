import { after, NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { adminDb } from "../firebase-admin";
import { FirebaseConfigurationError } from "../firebase-admin-config";
import { json, HttpError } from "../server/http";
import {
  actor,
  coordinator,
  createPairing,
  device,
  pairDevice,
  deviceCookie,
  cookieOptions,
  SESSION_SECONDS,
  renewCookie,
  sameOrigin,
  enabled,
} from "./auth";
import { BUILD, PickupError } from "./model";
import { PickupStore, actionSchema, printer } from "./store";
import { tabs } from "./google";
const store = new PickupStore(adminDb);
const staff = new Set([
  "getStation",
  "listRegistrations",
  "requestAction",
  "addWalkIn",
  "checkPrintStatus",
  "resumePrint",
  "confirmPrinted",
]);
const coordinatorMethods = new Set([
  "getSetupChecklist",
  "configurePickupEvent",
  "previewSheetImport",
  "syncResponses",
  "resolveDuplicate",
  "createDeviceEnrollment",
  "listDeviceAccess",
  "revokeDevice",
  "syncAttendanceToSource",
  "installAttendanceSync",
  "setupStation",
]);
export function pickupFailure(error: unknown) {
  let status = 500,
    message =
      "Request failed. Saved check-ins remain recorded. Refresh before retrying.";
  if (error instanceof FirebaseConfigurationError) {
    status = 503;
    message = error.message;
  } else if (error instanceof PickupError) {
    status = error.status;
    message = error.message;
  } else if (error instanceof ZodError) {
    status = 400;
    message = error.issues
      .map((e) => e.path.join(".") + ": " + e.message)
      .join("; ");
  } else if (error instanceof HttpError) {
    status = error.status;
    message = error.code;
  }
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
const text = (input: unknown) => z.string().min(1).max(500).parse(input);
export async function pickupPost(request: NextRequest) {
  try {
    enabled();
    sameOrigin(request);
    const { method, args } = z
      .object({ method: z.string().max(50), args: z.array(z.unknown()).max(2) })
      .strict()
      .parse(await json(request));
    if (method === "getBuild")
      return NextResponse.json(BUILD, {
        headers: { "Cache-Control": "no-store" },
      });
    if (method === "getBootstrap") {
      let paired = false;
      try {
        const who = await device(request);
        const response = NextResponse.json(
          { authMode: "devices", paired: true },
          { headers: { "Cache-Control": "no-store" } },
        );
        renewCookie(response, who);
        return response;
      } catch (e) {
        if (!(e instanceof PickupError) || e.status !== 401) throw e;
        paired = false;
      }
      return NextResponse.json(
        { authMode: "devices", paired },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (method === "enrollDevice") {
      const paired = await pairDevice(
        z
          .string()
          .regex(/^\d{6}$/)
          .parse(String(args[0] || "").replace(/\s/g, "")),
        request,
      );
      const response = NextResponse.json(
        { label: paired.label, expiresAt: paired.expiresAt },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.set(deviceCookie(), paired.credential, {
        ...cookieOptions,
        maxAge: SESSION_SECONDS,
      });
      return response;
    }
    if (!staff.has(method) && !coordinatorMethods.has(method))
      throw new PickupError(400, "Unknown pickup operation.");
    const who = coordinatorMethods.has(method)
      ? await coordinator(request)
      : await actor(request);
    let result: unknown;
    switch (method) {
      case "getStation": {
        const sync = (await adminDb.doc("pickupSync/import").get()).data();
        let configured = true;
        try {
          printer();
        } catch {
          configured = false;
        }
        result = {
          actor: who.id,
          admin: who.admin,
          deviceLabel: who.label || null,
          events: await store.events(),
          station: "Food packing station",
          configured,
          lastSync: sync?.lastSync || null,
        };
        break;
      }
      case "listRegistrations":
        result = await store.list(text(args[0]));
        break;
      case "requestAction":
        result = await store.action(actionSchema.parse(args[0]), who.id);
        break;
      case "addWalkIn":
        result = await store.addWalkIn(args[0], who.id);
        break;
      case "checkPrintStatus":
        result = {
          job: await store.checkPrintStatus(
            z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .parse(args[0]),
          ),
        };
        break;
      case "confirmPrinted":
        result = await store.confirmPrinted(text(args[0]));
        break;
      case "resumePrint":
        result = await store.resumePrint(text(args[0]));
        break;
      case "getSetupChecklist": {
        const checks: {
          key: string;
          label: string;
          ok: boolean;
          detail: string;
        }[] = [
          {
            key: "storage",
            label: "Firebase storage",
            ok: true,
            detail:
              "Check-ins and jobs are saved transactionally in Firestore.",
          },
        ];
        let sourceTabs: Awaited<ReturnType<typeof tabs>> = [];
        try {
          sourceTabs = await tabs();
          checks.push({
            key: "source",
            label: "Google response workbook",
            ok: true,
            detail: `${sourceTabs.length} tabs available.`,
          });
        } catch (e) {
          checks.push({
            key: "source",
            label: "Google response workbook",
            ok: false,
            detail:
              e instanceof PickupError
                ? e.message
                : "Google access unavailable.",
          });
        }
        try {
          printer();
          checks.push({
            key: "printer",
            label: "PrintNode configuration",
            ok: true,
            detail:
              "Configuration present. Verify physical labels before live use.",
          });
        } catch (e) {
          checks.push({
            key: "printer",
            label: "PrintNode configuration",
            ok: false,
            detail: (e as Error).message,
          });
        }
        const attendance = (
          await adminDb.doc("pickupSync/attendance").get()
        ).data();
        checks.push({
          key: "attendance",
          label: "Attendance export",
          ok: !attendance?.lastError,
          detail:
            attendance?.lastError ||
            `Last export: ${attendance?.lastSync || "never"}. Automatic export ${attendance?.enabled !== false ? "enabled" : "paused"}. ${attendance?.dirty ? "Changes waiting to sync." : "Up to date."}`,
        });
        const events = await store.events();
        if (!events.length)
          checks.push({
            key: "event",
            label: "Pickup event",
            ok: false,
            detail:
              "Enable a pickup tab, then preview and import its responses.",
          });
        result = {
          configVersion: String(
            (await adminDb.doc("pickupSettings/config").get()).data()
              ?.version || 0,
          ),
          checks,
          tabs: sourceTabs.filter((t) => t.title !== "FRFS Attendance"),
          events,
          lastChange: null,
        };
        break;
      }
      case "configurePickupEvent":
        result = await store.configureEvent(args[0]);
        break;
      case "previewSheetImport":
        result = (await store.preview()).map(({ parsed, event, ...safe }) => {
          void parsed;
          void event;
          return safe;
        });
        break;
      case "syncResponses":
        result = await store.importSource();
        break;
      case "resolveDuplicate":
        result = await store.resolveDuplicate(args[0], who.id);
        break;
      case "createDeviceEnrollment": {
        const q = z
          .object({ label: z.string().trim().min(1).max(80) })
          .parse(args[0]);
        result = await createPairing(q.label, who);
        break;
      }
      case "listDeviceAccess":
        result = (await adminDb.collection("pickupDevices").get()).docs.map(
          (d) => ({
            id: d.id,
            label: d.data().label,
            createdAt: new Date(d.data().createdAt).toISOString(),
            expiresAt: new Date(d.data().expiresAt).toISOString(),
            revokedAt: d.data().revokedAt
              ? new Date(d.data().revokedAt).toISOString()
              : null,
          }),
        );
        break;
      case "revokeDevice":
        await adminDb
          .doc(
            `pickupDevices/${z
              .string()
              .regex(/^[a-f0-9]{32}$/)
              .parse(args[0])}`,
          )
          .update({ revokedAt: Date.now(), revokedBy: who.id });
        result = { message: "Device access revoked." };
        break;
      case "syncAttendanceToSource":
        result = await store.exportAttendance();
        break;
      case "installAttendanceSync":
        result = await store.exportAttendance();
        await adminDb
          .doc("pickupSync/attendance")
          .set({ enabled: true, dirty: true }, { merge: true });
        result = {
          ...(result as object),
          message:
            "Automatic attendance export to dated pickup tabs enabled. Check-ins and list refreshes trigger background sync; an authenticated worker schedule provides an additional retry.",
        };
        break;
      case "setupStation":
        result =
          "Firebase storage is ready; no spreadsheet initialization is needed.";
        break;
    }
    if (["requestAction", "addWalkIn", "listRegistrations"].includes(method)) {
      after(async () => {
        await store.syncAttendance();
      });
    }
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
    renewCookie(response, who);
    return response;
  } catch (error) {
    return pickupFailure(error);
  }
}
