/* Coordinator setup and read-only print-service diagnostics. */
function getSetupChecklist() {
  actor_(true);
  const c = config_(),
    checks = [];
  function check(key, label, fn) {
    try {
      checks.push({ key, label, ok: true, detail: fn() });
    } catch (e) {
      checks.push({ key, label, ok: false, detail: e.message });
    }
  }
  check("storage", "Working spreadsheet", () => {
    read_("Registrations");
    read_("Jobs");
    return "Storage is readable. Only this separate workbook receives arrivals and print history.";
  });
  let tabs = [];
  if (c.source?.type === "sheets")
    check("source", "Response sheet", () => {
      tabs = inspectSourceTabs();
      return (
        tabs.length + " source tabs found. Source cells will not be changed."
      );
    });
  else
    check("source", "Response source", () => {
      if (!c.formId) throw new Error("Configure the source first.");
      return "Direct Form source configured; use the editor for field mapping.";
    });
  check("event", "Pickup event", () => {
    const events = c.events.filter((e) => e.enabled !== false);
    if (!events.length)
      throw new Error("Choose and enable the intended pickup tab below.");
    return events.map((e) => e.label).join(", ");
  });
  check("printer", "Print configuration", () => {
    const p = profile_();
    return (
      "Printer " +
      p.id +
      " · " +
      p.widthIn +
      " × " +
      p.heightIn +
      " in · " +
      p.dpi +
      " dpi. Configuration only; physical printing is not verified."
    );
  });
  return {
    configVersion: digest_(JSON.stringify(c)),
    checks,
    tabs,
    events: c.events.map((e) => ({
      id: e.id,
      label: e.label,
      sourceSheetId: e.sourceSheetId ?? null,
      enabled: e.enabled !== false,
    })),
    lastChange: c.lastSetupChange || null,
  };
}
function configurePickupEvent(request) {
  const actor = actor_(true);
  if (
    !request ||
    !Number.isInteger(request.sourceSheetId) ||
    request.sourceSheetId < 0 ||
    clean_(request.label).length < 3 ||
    clean_(request.label).length > 100
  )
    throw new Error(
      "Choose a source tab and enter a pickup label of 3–100 characters.",
    );
  return locked_(() => {
    const c = config_();
    if (c.source?.type !== "sheets")
      throw new Error("Tab setup is available for the Sheet source only.");
    if (request.configVersion !== digest_(JSON.stringify(c)))
      throw new Error(
        "Setup changed in another session. Reload setup before saving.",
      );
    const tabs = SpreadsheetApp.openById(c.source.spreadsheetId).getSheets();
    if (!tabs.some((t) => t.getSheetId() === request.sourceSheetId))
      throw new Error("That tab no longer exists. Reload setup.");
    const matches = c.events.filter(
      (e) => e.sourceSheetId === request.sourceSheetId,
    );
    if (matches.length > 1)
      throw new Error(
        "This tab has conflicting event mappings. Correct the configuration first.",
      );
    const existing = matches[0];
    const event = existing || {
      id: "sheet-" + request.sourceSheetId,
      sourceSheetId: request.sourceSheetId,
    };
    const prior = read_("Registrations").filter(
      (r) =>
        r.sourceKind === "sheets" &&
        r.sourceSpreadsheetId === c.source.spreadsheetId &&
        r.sourceSheetId === request.sourceSheetId,
    );
    if (prior.some((r) => r.eventId !== event.id))
      throw new Error(
        "This tab has imported history under another event. Reconcile it before activation.",
      );
    // Only these allowlisted fields can change. Source, staff, credentials and printer stay server-owned.
    event.label = clean_(request.label);
    event.enabled = true;
    if (!existing) c.events.push(event);
    c.lastSetupChange = {
      actor,
      at: now_(),
      eventId: event.id,
      sourceSheetId: event.sourceSheetId,
    };
    PropertiesService.getScriptProperties().setProperty(
      "CONFIG",
      JSON.stringify(c),
    );
    return {
      eventId: event.id,
      message:
        "Pickup event enabled. No source data was imported and no labels were printed.",
    };
  });
}
function checkPrintStatus(jobId) {
  actor_(false);
  const job = locked_(() => read_("Jobs").find((j) => j.id === jobId));
  if (!job) throw new Error("Print job not found.");
  if (!Number.isInteger(job.providerId) || job.providerId < 1)
    return {
      job: publicJob_(job),
      message:
        "No print-service job ID is available. Check the physical printer and its queue before reprinting.",
    };
  if (
    job.providerCheckedAt &&
    Date.now() - Date.parse(job.providerCheckedAt) < 15000
  )
    return {
      job: publicJob_(job),
      message: "Showing the service status checked in the last 15 seconds.",
    };
  const key =
    PropertiesService.getScriptProperties().getProperty("PRINTNODE_API_KEY");
  if (!key)
    throw new Error(
      "A coordinator must configure the print-service credential.",
    );
  let states;
  try {
    const response = UrlFetchApp.fetch(
      "https://api.printnode.com/printjobs/" + job.providerId + "/states",
      {
        method: "get",
        muteHttpExceptions: true,
        headers: {
          Authorization: "Basic " + Utilities.base64Encode(key + ":"),
        },
      },
    );
    if (response.getResponseCode() !== 200)
      throw new Error("service request failed");
    const payload = JSON.parse(response.getContentText());
    if (!Array.isArray(payload)) throw new Error("invalid response");
    states = payload
      .flat()
      .filter(
        (s) =>
          s &&
          s.printJobId === job.providerId &&
          typeof s.state === "string" &&
          Number.isFinite(Date.parse(s.createTimestamp)),
      );
  } catch (_) {
    throw new Error(
      "Could not read print-service status. The saved print outcome has not changed; do not automatically reprint.",
    );
  }
  const latest = states.sort(
    (a, b) => Date.parse(b.createTimestamp) - Date.parse(a.createTimestamp),
  )[0];
  if (!latest)
    return {
      job: publicJob_(job),
      message:
        "The service returned no usable status for this job. Check the station before reprinting.",
    };
  const updated = locked_(() => {
    const j = read_("Jobs").find((x) => x.id === jobId);
    // A slower response must not replace a newer observation or overwrite staff confirmation.
    if (
      !j.providerStateAt ||
      Date.parse(latest.createTimestamp) >= Date.parse(j.providerStateAt)
    ) {
      j.providerState = [
        "new",
        "sent_to_client",
        "done",
        "error",
        "expired",
      ].includes(latest.state)
        ? latest.state
        : "unknown";
      j.providerStateAt = latest.createTimestamp;
    }
    j.providerCheckedAt = now_();
    save_("Jobs", j);
    return j;
  });
  return {
    job: publicJob_(updated),
    message:
      "Service status refreshed. Physical printing still needs staff confirmation.",
  };
}
