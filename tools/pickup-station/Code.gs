/* Standalone Apps Script. See README for staff and coordinator deployments. Helpers ending in _
   cannot be called through google.script.run. Printer credentials stay server-side; browsers hold device tokens. */
// Version stamp. Change it with every code change; the page compares it with its own stamp
// so a coordinator can see whether both deployments run the latest code.
function getBuild() {
  return "2026-11-05.6";
}
function config_() {
  const props = PropertiesService.getScriptProperties();
  const c = JSON.parse(props.getProperty("CONFIG") || "{}");
  if (
    !c.sheetId ||
    !Array.isArray(c.staff) ||
    !Array.isArray(c.admins) ||
    !Array.isArray(c.events)
  )
    throw new Error("Coordinator must configure the station first.");
  if (c.source?.type === "sheets" && c.source.spreadsheetId === c.sheetId)
    throw new Error(
      "Source and working spreadsheets must be different. No source writes are permitted.",
    );
  return c;
}
function actor_(admin) {
  const c = config_();
  if (typeof deviceContext_ !== "undefined" && deviceContext_) {
    if (admin) throw new Error("This iPad cannot access coordinator controls.");
    return "device:" + deviceContext_.id;
  }
  const email = String(Session.getActiveUser().getEmail() || "").toLowerCase();
  const allowed = (
    admin || c.authMode === "devices" ? c.admins : c.staff.concat(c.admins)
  ).map((x) => x.toLowerCase());
  if (!email || !allowed.includes(email))
    throw new Error("This Google account is not authorized.");
  return email;
}
function doGet(e) {
  const coordinator = e?.parameter?.coordinator === "1";
  if (config_().authMode !== "devices" || coordinator) actor_(coordinator);
  // The device landing page contains only the static shell, never household data.
  const html = HtmlService.createHtmlOutputFromFile("Index")
    .getContent()
    .replace(
      'data-coordinator="false"',
      'data-coordinator="' + String(coordinator) + '"',
    );
  return HtmlService.createHtmlOutput(html)
    .setTitle("Food pickup | Front Range Food Source")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
function sheet_(name) {
  const s = SpreadsheetApp.openById(config_().sheetId).getSheetByName(name);
  if (!s) throw new Error("Coordinator must run setupStation first.");
  return s;
}
function read_(name) {
  const s = sheet_(name);
  if (s.getLastRow() < 2) return [];
  return s
    .getRange(2, 1, s.getLastRow() - 1, 2)
    .getValues()
    .map((row) => JSON.parse(row[1]));
}
function save_(name, record) {
  const s = sheet_(name),
    records = read_(name);
  const idx = records.findIndex((r) => r.id === record.id);
  const json = JSON.stringify(record);
  if (json.length > 45000) throw new Error("Record too large.");
  s.getRange(idx < 0 ? s.getLastRow() + 1 : idx + 2, 1, 1, 2).setValues([
    [record.id, json],
  ]);
  SpreadsheetApp.flush();
}
function now_() {
  return new Date().toISOString();
}
function event_(id) {
  const event = config_().events.find(
    (e) => e.id === id && e.enabled !== false,
  );
  if (!event) throw new Error("Select a configured pickup event.");
  return event;
}
function setupStation() {
  actor_(true);
  return locked_(() => {
    const book = SpreadsheetApp.openById(config_().sheetId);
    ["Registrations", "Jobs", "Devices", "Enrollments"].forEach((name) => {
      if (!book.getSheetByName(name))
        book.insertSheet(name).appendRow(["id", "record_json"]);
    });
    return "Station storage ready. Deploy as the user accessing the web app.";
  });
}
function getStation() {
  const actor = actor_(false),
    c = config_();
  return {
    actor,
    deviceLabel:
      typeof deviceContext_ !== "undefined" && deviceContext_
        ? deviceContext_.label
        : null,
    admin: c.admins.map((x) => x.toLowerCase()).includes(actor),
    events: c.events
      .filter((e) => e.enabled !== false)
      .map((e) => ({ id: e.id, label: e.label })),
    station: c.stationName || "Packing station",
    configured: !!(
      c.printer &&
      c.printer.id &&
      PropertiesService.getScriptProperties().getProperty("PRINTNODE_API_KEY")
    ),
    lastSync:
      PropertiesService.getScriptProperties().getProperty("LAST_SYNC") || null,
  };
}
function listRegistrations(eventId) {
  actor_(false);
  event_(eventId);
  // Consistent view of check-in/job creation across two iPads.
  return locked_(() => {
    const jobs = read_("Jobs");
    return read_("Registrations")
      .filter((r) => r.eventId === eventId && !r.inactive)
      .map((r) => {
        const related = jobs.filter((j) => j.registrationId === r.id);
        return Object.assign({}, r, {
          jobs: related.slice(-5).reverse().map(publicJob_),
          lastJob: related.length
            ? publicJob_(related[related.length - 1])
            : null,
        });
      });
  });
}
function publicJob_(j) {
  const status =
    j.status === "Sending" && Date.now() - Date.parse(j.createdAt) > 120000
      ? "Outcome unknown"
      : j.status;
  return {
    id: j.id,
    status,
    action: j.action,
    providerState: j.providerState || null,
    providerCheckedAt: j.providerCheckedAt || null,
    failureReason: j.failureReason || null,
    createdAt: j.createdAt,
    revision: j.revision,
    copies: j.copies,
    reason: j.reason,
    providerId: j.providerId || null,
    station: j.station,
    arrival: j.arrival || null,
    confirmedAt: j.confirmedAt || null,
  };
}
function clean_(value) {
  return String(value == null ? "" : value)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalize_(input) {
  const name = clean_(input.name),
    phone = clean_(input.phone),
    size = clean_(input.householdSize);
  const householdSize = /^\d+$/.test(size) ? Number(size) : null;
  const errors = [];
  if (!name || name.length > 100)
    errors.push("Name must contain 1–100 characters.");
  if (!phone || phone.length > 40)
    errors.push(
      "Phone is missing or too long. Correct the source; use “No phone” if confirmed.",
    );
  if (
    !Number.isInteger(householdSize) ||
    householdSize < 1 ||
    householdSize > 99
  )
    errors.push("Review household size (expected 1–99).");
  return {
    name,
    phone,
    phoneSearch: phone.replace(/\D/g, ""),
    householdSize,
    errors,
  };
}
function inspectFormFields() {
  actor_(true);
  return FormApp.openById(config_().formId)
    .getItems()
    .map((i) => ({ id: String(i.getId()), title: i.getTitle() }));
}
function syncResponses() {
  actor_(true);
  return syncImpl_();
}
function installSyncTrigger() {
  actor_(true);
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "scheduledSync_")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("scheduledSync_").timeBased().everyMinutes(5).create();
  return "Refresh scheduled every five minutes under this coordinator account.";
}
function scheduledSync_() {
  const email = String(
    Session.getEffectiveUser().getEmail() || "",
  ).toLowerCase();
  if (
    !config_()
      .admins.map((x) => x.toLowerCase())
      .includes(email)
  )
    throw new Error("Trigger owner is not an authorized coordinator.");
  syncImpl_();
}
function syncImpl_() {
  if (config_().source?.type === "sheets") return syncSheets_();
  const c = config_(),
    f = c.fields || {};
  if (!c.formId || !f.name || !f.phone || !f.householdSize || !f.event)
    throw new Error("Configure Form ID and the four item IDs first.");
  const form = FormApp.openById(c.formId),
    ids = form.getItems().map((i) => String(i.getId()));
  if (Object.values(f).some((id) => !ids.includes(String(id))))
    throw new Error("A mapped Form question is missing. No records imported.");
  const responses = form.getResponses();
  if (responses.length > 2000)
    throw new Error(
      "This pilot supports up to 2,000 source responses. Narrow the source before importing.",
    );
  return locked_(() => {
    const existing = read_("Registrations"),
      updated = [];
    let imported = 0,
      unassigned = 0,
      needsReview = 0;
    responses.forEach((response) => {
      const answers = {};
      response
        .getItemResponses()
        .forEach(
          (r) => (answers[String(r.getItem().getId())] = r.getResponse()),
        );
      const event = c.events.find(
        (e) => String(e.sourceValue) === clean_(answers[f.event]),
      );
      const data = normalize_({
        name: answers[f.name],
        phone: answers[f.phone],
        householdSize: answers[f.householdSize],
      });
      if (!event) unassigned++;
      if (data.errors.length) needsReview++;
      const id = c.formId + ":" + response.getId(),
        old = existing.find((r) => r.id === id);
      const fingerprint = JSON.stringify([
        data.name,
        data.phone,
        data.householdSize,
        event ? event.id : null,
      ]);
      if (old && old.eventId !== (event ? event.id : null) && old.checkedInAt)
        throw new Error(
          "An arrived registration changed pickup events. Coordinator must reconcile it before syncing.",
        );
      const record = Object.assign({}, old || {}, data, {
        id,
        eventId: event ? event.id : null,
        revision: old
          ? old.revision + (old.fingerprint === fingerprint ? 0 : 1)
          : 1,
        fingerprint,
        sourceSubmittedAt: response.getTimestamp().toISOString(),
        importedAt: now_(),
      });
      record.inactive = false;
      updated.push(record);
      imported++;
    });
    existing
      .filter((r) => !updated.some((n) => n.id === r.id))
      .forEach((r) =>
        updated.push(r.walkIn ? r : Object.assign({}, r, { inactive: true })),
      );
    if (updated.length)
      sheet_("Registrations")
        .getRange(2, 1, updated.length, 2)
        .setValues(updated.map((r) => [r.id, JSON.stringify(r)]));
    SpreadsheetApp.flush();
    const stamp = now_();
    PropertiesService.getScriptProperties().setProperty("LAST_SYNC", stamp);
    return { imported, unassigned, needsReview, lastSync: stamp };
  });
}
function profile_() {
  const p = config_().printer || {};
  if (
    !Number.isInteger(p.id) ||
    p.id < 1 ||
    ![203, 300].includes(p.dpi) ||
    !(p.widthIn >= 1.5 && p.widthIn <= 4.1) ||
    !(p.heightIn >= 1 && p.heightIn <= 4)
  )
    throw new Error(
      "Coordinator must configure printer ID, DPI and measured label size.",
    );
  if (!PropertiesService.getScriptProperties().getProperty("PRINTNODE_API_KEY"))
    throw new Error("Print service is not configured.");
  return p;
}
function hex_(text) {
  // Hex-encode all UTF-8 bytes: user text cannot inject ^XZ or other commands.
  return Array.from(unescape(encodeURIComponent(text)))
    .map(
      (c) => "_" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase(),
    )
    .join("");
}
function wrap_(text, columns) {
  const words = text.split(" "),
    lines = [""];
  words.forEach((word) => {
    if (word.length > columns)
      throw new Error(
        "Name has a word too long for this label. Review the source or label profile.",
      );
    const n = lines.length - 1;
    if ((lines[n] ? lines[n].length + 1 : 0) + word.length > columns)
      lines.push(word);
    else lines[n] += (lines[n] ? " " : "") + word;
  });
  if (lines.length > 2)
    throw new Error(
      "Name needs more than two lines. Review the label profile before printing.",
    );
  return lines;
}
function renderZpl_(r, p, copies, arrival) {
  // Proportional layout: text scales to fill the configured label, so the same code
  // works for 2.25 x 1.25 in and 4 x 2 in stock at 203 or 300 dpi.
  const W = Math.round(p.widthIn * p.dpi),
    H = Math.round(p.heightIn * p.dpi),
    m = Math.round(0.06 * p.dpi),
    aw = W - 2 * m,
    ah = H - 2 * m;
  // Font A0 with width equal to height prints at normal proportions. 0.62 of the width
  // per character is a cautious estimate (about 0.5 was measured on a ZD421).
  const CF = 0.62;
  const room = (text, h, space) =>
    Math.min(h, Math.floor((space || aw) / (text.length * CF)));
  const vehicle = arrival && arrival.vehicle ? arrival.vehicle : "";
  const prepacked = r.pickupType === "prepacked";
  const phone = "Phone: " + r.phone,
    household = "Household: " + r.householdSize + " people";
  function units(nameLines) {
    let t = 0;
    if (arrival) t += 2.0 + 0.3;
    t += nameLines * 1.4 + (nameLines - 1) * 0.15 + 0.3;
    if (prepacked) t += 1.1 + 0.25;
    if (vehicle) t += 1.0 + 0.25;
    return t + 1.0 + 0.25 + 1.0;
  }
  const unitFor = (lines) => Math.min(ah / units(lines), 0.25 * p.dpi);
  function split(name) {
    const words = name.split(" ");
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" "),
        b = words.slice(i).join(" ");
      if (!best || Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length))
        best = [a, b];
    }
    return best || [name];
  }
  let u = unitFor(1),
    nameLines = [r.name];
  if (room(r.name, 1.4 * u) < 0.7 * 1.4 * u) {
    const two = split(r.name);
    if (two.length === 2) {
      nameLines = two;
      u = unitFor(2);
    }
  }
  const nameH = Math.round(1.4 * u),
    nameW = Math.min(...nameLines.map((t) => room(t, nameH)));
  if (nameW < 0.45 * nameH)
    throw new Error(
      "Name is too long for this label. Review the source or the label size.",
    );
  const out = ["^XA", "^CI28", "^PW" + W, "^LL" + H, "^LH0,0"];
  let y = m;
  function field(text, h, w, x, reverse) {
    out.push(
      "^FO" + x + "," + y + "^A0N," + h + "," + w + (reverse ? "^FR" : "") +
        "^FH_^FD" + hex_(text) + "^FS",
    );
  }
  function line(text, h, gapAfter) {
    const w = room(text, h);
    if (w < 0.45 * h)
      throw new Error("Label text does not fit this label: " + text.length + " characters.");
    field(text, h, w, m, false);
    y += h + Math.round(gapAfter * u);
  }
  if (arrival) {
    // Header: car number left, line word in a box right. ORANGE is white on black so the
    // two lines look different at a glance on a black-only thermal label.
    const numH = Math.round(1.6 * u),
      boxH = Math.round(2.0 * u),
      wordH = Math.round(1.2 * u),
      padX = Math.round(0.35 * u),
      wordW = wordH,
      boxW = Math.ceil(6 * CF * wordW) + 2 * padX,
      word = arrival.line === "orange" ? "ORANGE" : "BLUE",
      boxX = W - m - boxW,
      number = "#" + arrival.number;
    if (number.length * CF * numH + boxW + padX > aw)
      throw new Error("Label is too narrow for the car number and line.");
    const top = y;
    y = top + Math.round((boxH - numH) / 2);
    field(number, numH, numH, m, false);
    y = top;
    out.push(
      "^FO" + boxX + "," + top + "^GB" + boxW + "," + boxH + "," +
        (arrival.line === "orange" ? boxH : Math.max(3, Math.round(0.03 * p.dpi))) + "^FS",
    );
    y = top + Math.round((boxH - wordH) / 2);
    field(word, wordH, wordW, boxX + Math.round((boxW - word.length * CF * wordW) / 2), arrival.line === "orange");
    y = top + boxH + Math.round(0.3 * u);
  }
  if (prepacked) {
    // Walk-up households get a white-on-black bar so packers grab a pre-packed box.
    const barH = Math.round(1.1 * u),
      textH = Math.round(0.8 * u),
      text = "PRE-PACKED PICKUP",
      w = room(text, textH, aw - Math.round(0.6 * u)),
      top = y;
    out.push("^FO" + m + "," + top + "^GB" + aw + "," + barH + "," + barH + "^FS");
    y = top + Math.round((barH - textH) / 2);
    field(text, textH, w, m + Math.max(0, Math.round((aw - text.length * CF * w) / 2)), true);
    y = top + barH + Math.round(0.25 * u);
  }
  nameLines.forEach((t, i) => {
    field(t, nameH, nameW, m, false);
    y += nameH + Math.round((i < nameLines.length - 1 ? 0.15 : 0.3) * u);
  });
  const detailH = Math.round(u);
  if (vehicle) line(vehicle, detailH, 0.25);
  line(phone, detailH, 0.25);
  line(household, detailH, 0);
  if (y > H - m + 2) throw new Error("Label is too short for these fields.");
  out.push("^PQ" + copies, "^XZ");
  return out.join("\n");
}
// Car-line arrival details: 3-digit number, blue/orange line, optional short vehicle description.
function arrival_(input, required) {
  if (!input) {
    if (required)
      throw new Error(
        "Choose this iPad’s car line and enter the 3-digit number before checking in.",
      );
    return null;
  }
  const number = clean_(input.number),
    line = clean_(input.line).toLowerCase(),
    vehicle = clean_(input.vehicle);
  if (!/^\d{3}$/.test(number)) throw new Error("Enter the 3-digit number.");
  if (!["blue", "orange"].includes(line))
    throw new Error("Choose the blue or orange line.");
  if (vehicle.length > 30)
    throw new Error("Keep the vehicle description to 30 characters.");
  return { number, line, vehicle };
}
function requestAction(request) {
  const actor = actor_(false);
  if (
    !request ||
    !["checkin", "advance", "reprint", "checkinOnly"].includes(request.action)
  )
    throw new Error("Unknown action.");
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(request.token || ""))
    throw new Error("Invalid request token.");
  if (
    !Number.isInteger(request.copies) ||
    request.copies < 1 ||
    request.copies > 3
  )
    throw new Error("Choose 1–3 copies.");
  const arrivalInput = ["checkin", "checkinOnly"].includes(request.action)
    ? arrival_(request.arrival, true)
    : request.action === "reprint"
      ? arrival_(request.arrival, false)
      : null;
  const prepared = locked_(() => {
    const r = read_("Registrations").find((x) => x.id === request.id);
    if (!r || r.inactive)
      throw new Error("Registration no longer exists. Refresh the list.");
    event_(r.eventId);
    if (r.reviewRequired)
      throw new Error(
        "Coordinator review required before this household can check in or print.",
      );
    if (r.revision !== request.revision)
      throw new Error("Registration changed. Refresh and review it first.");
    const jobs = read_("Jobs"),
      previous = jobs.find((j) => j.token === request.token);
    if (previous) {
      if (
        previous.registrationId !== r.id ||
        previous.action !== request.action
      )
        throw new Error("Request token already used for another action.");
      if (previous.action === "checkin" && !r.checkedInAt) {
        r.checkedInAt = previous.createdAt;
        r.checkedInBy = previous.actor;
        r.arrivalJobId = previous.id;
        r.arrival = previous.arrival || null;
        save_("Registrations", r);
      }
      return { record: r, job: previous, reused: true };
    }
    // A registration-level guard also protects two distinct requests from two iPads.
    if (
      (request.action === "checkin" || request.action === "checkinOnly") &&
      r.checkedInAt
    )
      return {
        record: r,
        job: jobs.find((j) => j.id === r.arrivalJobId) || null,
        reused: true,
      };
    if (request.action === "checkin") {
      const orphan = jobs.find(
        (j) => j.registrationId === r.id && j.action === "checkin",
      );
      if (orphan) {
        r.checkedInAt = orphan.createdAt;
        r.checkedInBy = orphan.actor;
        r.arrivalJobId = orphan.id;
        r.arrival = orphan.arrival || null;
        save_("Registrations", r);
        return { record: r, job: orphan, reused: true };
      }
    }
    if (request.action === "advance") {
      const prior = jobs.find(
        (j) =>
          j.registrationId === r.id &&
          j.revision === r.revision &&
          j.action === "advance",
      );
      if (prior) return { record: r, job: prior, reused: true };
    }
    if (request.action === "reprint" && clean_(request.reason).length < 5)
      throw new Error("Enter a reprint reason (at least five characters).");
    if (request.action === "checkinOnly") {
      r.checkedInAt = now_();
      r.checkedInBy = actor;
      r.arrival = arrivalInput;
      save_("Registrations", r);
      return { record: r, job: null, reused: false };
    }
    if (r.errors.length)
      throw new Error(
        "Resolve source data marked Needs review before printing.",
      );
    // Arrival labels carry the car details. A reprint after arrival reuses them unless corrected.
    const arrival =
      request.action === "checkin"
        ? arrivalInput
        : request.action === "reprint" && r.checkedInAt
          ? arrivalInput || r.arrival || null
          : null;
    const p = profile_(),
      zpl = renderZpl_(r, p, request.copies, arrival);
    const job = {
      id: Utilities.getUuid(),
      token: request.token,
      registrationId: r.id,
      revision: r.revision,
      eventId: r.eventId,
      action: request.action,
      copies: request.copies,
      reason: clean_(request.reason || ""),
      actor,
      createdAt: now_(),
      status: "Prepared",
      station: config_().stationName || "Packing station",
      printerId: p.id,
      snapshot: {
        name: r.name,
        phone: r.phone,
        householdSize: r.householdSize,
      },
      arrival,
      zpl,
    };
    // Persist job first: a later write failure can be retried without printing twice.
    save_("Jobs", job);
    if (request.action === "checkin") {
      r.checkedInAt = now_();
      r.checkedInBy = actor;
      r.arrivalJobId = job.id;
      r.arrival = arrival;
      save_("Registrations", r);
    } else if (request.action === "reprint" && arrival && r.checkedInAt) {
      r.arrival = arrival;
      save_("Registrations", r);
    }
    return { record: r, job, reused: false };
  });
  if (prepared.job) dispatch_(prepared.job.id);
  return {
    reused: prepared.reused,
    checkedInAt: prepared.record.checkedInAt || null,
    arrival: prepared.record.arrival || null,
    job: prepared.job
      ? publicJob_(read_("Jobs").find((j) => j.id === prepared.job.id))
      : null,
  };
}
// Walk-up household that did not pre-register: added to the pickup as a Pre-Packed Pickup,
// checked in and (normally) printed in one step. The request token makes retries safe.
function addWalkIn(request) {
  const actor = actor_(false);
  if (!request || !/^[a-zA-Z0-9-]{16,70}$/.test(request.token || ""))
    throw new Error("Invalid request token.");
  const event = event_(request.eventId);
  const phoneIn = clean_(request.phone);
  const data = normalize_({
    name: request.name,
    phone: phoneIn || "No phone",
    householdSize: request.householdSize,
  });
  if (data.errors.length) throw new Error(data.errors.join(" "));
  arrival_(request.arrival, true);
  const print = request.print !== false;
  if (
    print &&
    (!Number.isInteger(request.copies) || request.copies < 1 || request.copies > 3)
  )
    throw new Error("Choose 1–3 copies.");
  const record = locked_(() => {
    const existing = read_("Registrations").find(
      (r) => r.walkInToken === request.token,
    );
    if (existing) return existing;
    const r = Object.assign({}, data, {
      id: "walkin:" + event.id + ":" + Utilities.getUuid(),
      eventId: event.id,
      phoneSearch: phoneIn ? data.phoneSearch : "",
      revision: 1,
      walkIn: true,
      pickupType: "prepacked",
      sourceKind: "walkin",
      walkInToken: request.token,
      addedBy: actor,
      addedAt: now_(),
      inactive: false,
    });
    save_("Registrations", r);
    return r;
  });
  const result = requestAction({
    id: record.id,
    revision: record.revision,
    action: print ? "checkin" : "checkinOnly",
    copies: print ? request.copies : 1,
    token: request.token + "-arrive",
    arrival: request.arrival,
  });
  return Object.assign({ id: record.id }, result);
}
function dispatch_(id) {
  const job = locked_(() => {
    const j = read_("Jobs").find((x) => x.id === id);
    if (!j || j.status !== "Prepared") return null;
    const registration = read_("Registrations").find(
      (r) => r.id === j.registrationId,
    );
    if (
      !registration ||
      registration.inactive ||
      registration.reviewRequired ||
      registration.errors.length ||
      registration.revision !== j.revision
    ) {
      j.status = "Failed";
      j.failureReason =
        "Source changed before dispatch; review and explicitly reprint.";
      save_("Jobs", j);
      return null;
    }
    j.status = "Sending";
    save_("Jobs", j);
    return j;
  });
  if (!job) return;
  let status = "Outcome unknown",
    providerId = null;
  try {
    const key =
      PropertiesService.getScriptProperties().getProperty("PRINTNODE_API_KEY");
    const res = UrlFetchApp.fetch("https://api.printnode.com/printjobs", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: {
        Authorization: "Basic " + Utilities.base64Encode(key + ":"),
        "X-Idempotency-Key": job.id,
      },
      payload: JSON.stringify({
        printerId: job.printerId,
        contentType: "raw_base64",
        content: Utilities.base64Encode(job.zpl, Utilities.Charset.UTF_8),
        title: "FRFS " + job.id,
        source: "FRFS Pickup Station",
        expireAfter: 120,
        qty: 1,
      }),
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      providerId = JSON.parse(res.getContentText());
      if (!Number.isInteger(providerId))
        throw new Error("Unexpected provider response");
      status = "Submitted";
    } else if ([400, 401, 403, 404, 413, 422, 429].includes(code))
      status = "Failed";
    // 409, timeout and 5xx are uncertain. Never automatically resend.
  } catch (_) {
    /* Do not log customer data or service response bodies. */
  }
  locked_(() => {
    const latest = read_("Jobs").find((j) => j.id === id);
    if (!latest.confirmedAt) latest.status = status;
    latest.providerId = providerId;
    latest.updatedAt = now_();
    save_("Jobs", latest);
  });
}
function confirmPrinted(jobId) {
  const actor = actor_(false);
  return locked_(() => {
    const j = read_("Jobs").find((x) => x.id === jobId);
    if (!j) throw new Error("Print job not found.");
    if (
      ![
        "Submitted",
        "Outcome unknown",
        "Sending",
        "Confirmed by staff",
      ].includes(j.status)
    )
      throw new Error("This job has not been submitted.");
    j.status = "Confirmed by staff";
    j.confirmedAt = now_();
    j.confirmedBy = actor;
    save_("Jobs", j);
    return publicJob_(j);
  });
}
// Resume only a never-dispatched job; uncertain/failed/submitted jobs are not retried.
function resumePrint(jobId) {
  actor_(false);
  const job = locked_(() => {
    const j = read_("Jobs").find((x) => x.id === jobId);
    if (!j) throw new Error("Print job not found.");
    if (j.status !== "Prepared") return j;
    const r = read_("Registrations").find((x) => x.id === j.registrationId);
    if (!r || r.inactive) throw new Error("Registration is no longer active.");
    event_(r.eventId);
    if (r.reviewRequired)
      throw new Error("Coordinator review required before resuming this job.");
    if (j.action === "checkin" && !r.checkedInAt) {
      r.checkedInAt = j.createdAt;
      r.checkedInBy = j.actor;
      r.arrivalJobId = j.id;
      r.arrival = j.arrival || null;
      save_("Registrations", r);
    }
    return j;
  });
  if (job.status === "Prepared") dispatch_(job.id);
  return publicJob_(read_("Jobs").find((j) => j.id === job.id));
}
