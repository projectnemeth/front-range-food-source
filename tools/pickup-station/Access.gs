/* Device enrollment for church-owned iPads. Only hashed credentials are stored. */
var deviceContext_ = null;
function getBootstrap() {
  return { authMode: config_().authMode === "devices" ? "devices" : "google" };
}
function deviceTable_(name) {
  return read_(name);
}
function createDeviceEnrollment(request) {
  const actor = actor_(true),
    c = config_();
  if (c.authMode !== "devices")
    throw new Error("Device access mode is not enabled.");
  const label = clean_(request?.label);
  if (!label || label.length > 80)
    throw new Error("Enter a device name of 1–80 characters.");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const code = locked_(() => {
    // A 4-digit PIN, unique among PINs still waiting to be used.
    const waiting = activeEnrollments_().map((e) => e.codeHash);
    let pin = null;
    for (let tries = 0; tries < 50 && !pin; tries++) {
      const n = parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 4), 16);
      if (n >= 60000) continue; // 60000 is divisible by 10000: no digit bias.
      const candidate = String(n % 10000).padStart(4, "0");
      if (!waiting.includes(digest_(candidate))) pin = candidate;
    }
    if (!pin) throw new Error("Could not create a PIN. Try again.");
    save_("Enrollments", {
      id: Utilities.getUuid(),
      codeHash: digest_(pin),
      label,
      createdBy: actor,
      createdAt: now_(),
      expiresAt,
      usedAt: null,
    });
    PropertiesService.getScriptProperties().setProperty("ENROLL_FAILS", "0");
    return pin;
  });
  return { code, expiresAt, label };
}
function activeEnrollments_() {
  return deviceTable_("Enrollments").filter(
    (e) => !e.usedAt && Date.parse(e.expiresAt) > Date.now(),
  );
}
// The staff address is public, so a short PIN is protected by a lockout: after five wrong
// PINs, every PIN still waiting to be used is canceled and a coordinator issues a new one.
const MAX_ENROLL_FAILS_ = 5;
function enrollDevice(code) {
  if (config_().authMode !== "devices")
    throw new Error("Device access mode is not enabled.");
  const normalized = String(code || "").replace(/\s/g, "");
  if (!/^\d{4}$/.test(normalized))
    throw new Error("Enter the 4-digit setup PIN from your coordinator.");
  return locked_(() => {
    const props = PropertiesService.getScriptProperties();
    const enrollment = activeEnrollments_().find(
      (e) => e.codeHash === digest_(normalized),
    );
    if (!enrollment) {
      const fails = Number(props.getProperty("ENROLL_FAILS") || 0) + 1;
      if (fails >= MAX_ENROLL_FAILS_) {
        activeEnrollments_().forEach((e) => {
          e.usedAt = now_();
          e.canceledReason = "Too many incorrect PINs";
          save_("Enrollments", e);
        });
        props.setProperty("ENROLL_FAILS", "0");
        throw new Error(
          "Too many incorrect PINs. Waiting PINs were canceled for safety. Ask a coordinator for a new PIN.",
        );
      }
      props.setProperty("ENROLL_FAILS", String(fails));
      throw new Error(
        "That PIN is incorrect, expired, or already used. Check it or ask a coordinator for a new PIN.",
      );
    }
    props.setProperty("ENROLL_FAILS", "0");
    const c = config_(),
      days = c.deviceSessionDays ?? 180;
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new Error(
        "Coordinator must configure a device session duration between 1 and 365 days.",
      );
    const token =
      Utilities.getUuid().replace(/-/g, "") +
      Utilities.getUuid().replace(/-/g, "");
    const device = {
      id: Utilities.getUuid(),
      label: enrollment.label,
      tokenHash: digest_(token),
      createdAt: now_(),
      expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      revokedAt: null,
      enrolledBy: enrollment.createdBy,
    };
    // Consume first. An interrupted enrollment needs a new code rather than risking reuse.
    enrollment.usedAt = now_();
    enrollment.deviceId = device.id;
    save_("Enrollments", enrollment);
    save_("Devices", device);
    return { token, label: device.label, expiresAt: device.expiresAt };
  });
}
function staffCall(token, method, args) {
  const methods = {
    getStation,
    listRegistrations,
    requestAction,
    confirmPrinted,
    resumePrint,
    checkPrintStatus,
    addWalkIn,
  };
  if (!Object.prototype.hasOwnProperty.call(methods, method))
    throw new Error("This iPad cannot access coordinator controls.");
  if (config_().authMode !== "devices")
    throw new Error("Device access mode is not enabled.");
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new Error(
      "DEVICE_ACCESS_REQUIRED: This iPad needs coordinator setup.",
    );
  const device = locked_(() =>
    deviceTable_("Devices").find((d) => d.tokenHash === digest_(token)),
  );
  if (!device || device.revokedAt || Date.parse(device.expiresAt) <= Date.now())
    throw new Error(
      "DEVICE_ACCESS_REQUIRED: This iPad’s authorization has expired or been revoked.",
    );
  if (!Array.isArray(args) || args.length > 2)
    throw new Error("Invalid device request.");
  deviceContext_ = device;
  try {
    return methods[method].apply(null, args);
  } finally {
    deviceContext_ = null;
  }
}
function listDeviceAccess() {
  actor_(true);
  return locked_(() =>
    deviceTable_("Devices").map((d) => ({
      id: d.id,
      label: d.label,
      createdAt: d.createdAt,
      expiresAt: d.expiresAt,
      revokedAt: d.revokedAt,
    })),
  );
}
function revokeDevice(deviceId) {
  const actor = actor_(true);
  return locked_(() => {
    const d = deviceTable_("Devices").find((x) => x.id === deviceId);
    if (!d) throw new Error("Device not found.");
    if (!d.revokedAt) {
      d.revokedAt = now_();
      d.revokedBy = actor;
      save_("Devices", d);
    }
    return { id: d.id, label: d.label, revokedAt: d.revokedAt };
  });
}
