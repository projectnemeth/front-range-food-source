/* Read-only source adapter. All mutations target the separate working sheet. */
function sheetSource_() {
  const c = config_(),
    source = c.source || {};
  if (
    source.type !== "sheets" ||
    !source.spreadsheetId ||
    source.spreadsheetId === c.sheetId
  )
    throw new Error(
      "Configure a source spreadsheet distinct from the working spreadsheet.",
    );
  const events = c.events.filter((e) => e.enabled !== false);
  if (!events.length)
    throw new Error(
      "Configure and explicitly enable the intended pickup event first.",
    );
  if (
    events.some((e) => !Number.isInteger(e.sourceSheetId)) ||
    new Set(events.map((e) => e.sourceSheetId)).size !== events.length
  )
    throw new Error(
      "Map each active event to a different numeric source tab ID.",
    );
  return { c, source, events };
}
function inspectSourceTabs() {
  actor_(true);
  const { source } = config_();
  if (!source?.spreadsheetId)
    throw new Error("Configure the source spreadsheet first.");
  return SpreadsheetApp.openById(source.spreadsheetId)
    .getSheets()
    .map((s) => ({ sheetId: s.getSheetId(), title: s.getName() }));
}
function digest_(text) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8,
  )
    .map((b) => (b & 255).toString(16).padStart(2, "0"))
    .join("");
}
function parseSourceRows_(headers, rows, mapping) {
  const columns = {},
    cleaned = headers.map(clean_);
  for (const field of [
    "externalId",
    "submittedAt",
    "name",
    "phone",
    "householdSize",
  ]) {
    const wanted = clean_(mapping[field]);
    const matches = cleaned
      .map((x, i) => (x === wanted && wanted ? i : -1))
      .filter((i) => i >= 0);
    if (matches.length !== 1)
      throw new Error(
        "Source header missing or ambiguous: " +
          field +
          ". No registrations changed.",
      );
    columns[field] = matches[0];
  }
  const groups = new Map();
  let sourceRows = 0,
    ignoredAfterList = 0;
  // Every registration has a name, so the list ends at the last named row. Totals or notes
  // below it are ignored and counted. A nameless row inside the list is still imported.
  let lastNamed = -1;
  rows.forEach((row, index) => {
    if (clean_(row[columns.name])) lastNamed = index;
  });
  rows.forEach((row, index) => {
    if (!Object.values(columns).some((col) => clean_(row[col]))) return;
    if (index > lastNamed) {
      ignoredAfterList++;
      return;
    }
    sourceRows++;
    const externalId = clean_(row[columns.externalId]);
    if (!externalId || externalId.length > 100)
      throw new Error(
        "Missing or invalid ID# at source row " +
          (index + 2) +
          ", inside the list (above its last name). Add an ID# or clear the row. No registrations changed.",
      );
    const submittedAt = clean_(row[columns.submittedAt]);
    const data = normalize_({
      name: row[columns.name],
      phone: row[columns.phone],
      householdSize: row[columns.householdSize],
    });
    if (!submittedAt) data.errors.push("Submission date is missing.");
    const key = digest_(
      JSON.stringify([submittedAt, data.name, data.phone, data.householdSize]),
    );
    if (!groups.has(externalId)) groups.set(externalId, []);
    groups
      .get(externalId)
      .push(
        Object.assign({}, data, { key, submittedAt, sourceRow: index + 2 }),
      );
  });
  return {
    sourceRows,
    groups,
    ignoredAfterList,
    lastListRow: lastNamed >= 0 ? lastNamed + 2 : null,
  };
}
function readSheetSource_() {
  const { source, events } = sheetSource_(),
    book = SpreadsheetApp.openById(source.spreadsheetId);
  const tabs = book.getSheets();
  let total = 0;
  return events.map((event) => {
    const tab = tabs.find((s) => s.getSheetId() === event.sourceSheetId);
    if (!tab)
      throw new Error(
        "Configured source tab is missing for " +
          event.label +
          ". No registrations changed.",
      );
    const lastRow = tab.getLastRow(),
      width = tab.getLastColumn();
    total += Math.max(0, lastRow - 1);
    if (width > 100 || total > 2000)
      throw new Error(
        "Pilot import limit: 100 columns and 2,000 rows across active tabs.",
      );
    if (!lastRow || !width)
      throw new Error(
        "Configured source tab is empty; no registrations changed.",
      );
    // Display values preserve phone and identifier formatting. Header mapping ignores trailing spaces.
    const headers = tab.getRange(1, 1, 1, width).getDisplayValues()[0];
    parseSourceRows_(headers, [], source.columns || {}); // Validate before reading data.
    const mappedWidth =
      1 +
      Math.max(
        ...Object.values(source.columns).map((header) =>
          headers.map(clean_).indexOf(clean_(header)),
        ),
      );
    const rows =
      lastRow > 1
        ? tab.getRange(2, 1, lastRow - 1, mappedWidth).getDisplayValues()
        : [];
    const parsed = parseSourceRows_(headers, rows, source.columns || {});
    return {
      event,
      sourceId: source.spreadsheetId,
      tabTitle: tab.getName(),
      ...parsed,
    };
  });
}
function previewSheetImport() {
  actor_(true);
  return readSheetSource_().map((p) => ({
    eventId: p.event.id,
    eventLabel: p.event.label,
    tabTitle: p.tabTitle,
    sourceRows: p.sourceRows,
    lastListRow: p.lastListRow,
    ignoredAfterList: p.ignoredAfterList,
    households: p.groups.size,
    duplicateGroups: [...p.groups.values()].filter((group) => group.length > 1)
      .length,
  }));
}
function sheetRecord_(part, externalId, candidates, old) {
  const sorted = candidates.slice().sort((a, b) => a.key.localeCompare(b.key));
  const groupKey = digest_(JSON.stringify(sorted.map((c) => c.key)));
  const review =
    old?.duplicateReview?.groupKey === groupKey ? old.duplicateReview : null;
  const chosen = review
    ? sorted.find((c) => c.key === review.candidateKey)
    : sorted[0];
  const reviewRequired = sorted.length > 1 && !review;
  const errors = chosen.errors.slice();
  if (reviewRequired)
    errors.push(
      "Repeated ID# in this pickup. A coordinator must choose the correct response before check-in or printing.",
    );
  const fingerprint = JSON.stringify([
    chosen.key,
    groupKey,
    review?.candidateKey || null,
    part.event.id,
  ]);
  const priorHistory = old?.duplicateReviewHistory || [];
  return Object.assign({}, old || {}, {
    id:
      "sheet:" +
      part.sourceId +
      ":" +
      part.event.sourceSheetId +
      ":" +
      encodeURIComponent(externalId),
    eventId: part.event.id,
    sourceKind: "sheets",
    sourceSpreadsheetId: part.sourceId,
    sourceSheetId: part.event.sourceSheetId,
    externalId,
    name: chosen.name,
    phone: chosen.phone,
    phoneSearch: chosen.phoneSearch,
    householdSize: chosen.householdSize,
    sourceSubmittedAt: chosen.submittedAt,
    sourceRow: chosen.sourceRow,
    errors,
    reviewRequired,
    duplicateCandidates: sorted.length > 1 ? sorted : [],
    groupKey,
    duplicateReview: review,
    duplicateReviewHistory: priorHistory,
    fingerprint,
    revision: old
      ? old.revision + (old.fingerprint === fingerprint ? 0 : 1)
      : 1,
    importedAt: now_(),
    inactive: false,
    sourceMissing: false,
  });
}
function syncSheets_() {
  // One script lock covers the source snapshot and persistence, so overlapping refreshes
  // cannot apply an older snapshot after a newer one or erase an arrival.
  return locked_(() => {
    const parts = readSheetSource_(),
      existing = read_("Registrations"),
      updates = [];
    for (const part of parts)
      for (const [externalId, candidates] of part.groups) {
        const id =
          "sheet:" +
          part.sourceId +
          ":" +
          part.event.sourceSheetId +
          ":" +
          encodeURIComponent(externalId);
        const old = existing.find((r) => r.id === id);
        if (old && old.eventId !== part.event.id)
          throw new Error(
            "A source tab was reassigned to a different event. Reconcile before importing.",
          );
        updates.push(sheetRecord_(part, externalId, candidates, old));
      }
    for (const part of parts) {
      if (
        !part.sourceRows &&
        existing.some(
          (r) =>
            !r.inactive &&
            r.sourceSpreadsheetId === part.sourceId &&
            r.sourceSheetId === part.event.sourceSheetId,
        )
      )
        throw new Error(
          "Previously populated source tab is now empty. Review the source before importing; no registrations changed.",
        );
    }
    const affected = (r) =>
      parts.some(
        (p) =>
          r.sourceKind === "sheets" &&
          r.sourceSpreadsheetId === p.sourceId &&
          r.sourceSheetId === p.event.sourceSheetId,
      );
    const records = updates.concat(
      existing
        .filter((r) => !updates.some((n) => n.id === r.id))
        .map((r) => {
          if (!affected(r)) return r;
          if (r.checkedInAt)
            return Object.assign({}, r, {
              sourceMissing: true,
              errors: [
                "Arrived household was removed from the source. Coordinator review required.",
              ],
              reviewRequired: true,
              revision: r.revision + (r.sourceMissing ? 0 : 1),
            });
          return Object.assign({}, r, { inactive: true });
        }),
    );
    const values = records.map((r) => [r.id, JSON.stringify(r)]);
    if (values.some((row) => row[1].length > 45000))
      throw new Error(
        "A registration has too many repeated responses or review history. No registrations changed.",
      );
    if (values.length)
      sheet_("Registrations")
        .getRange(2, 1, values.length, 2)
        .setValues(values);
    SpreadsheetApp.flush();
    const lastSync = now_();
    PropertiesService.getScriptProperties().setProperty("LAST_SYNC", lastSync);
    return {
      imported: updates.length,
      sourceRows: parts.reduce((n, p) => n + p.sourceRows, 0),
      ignoredAfterList: parts.reduce((n, p) => n + p.ignoredAfterList, 0),
      unassigned: 0,
      needsReview: updates.filter((r) => r.errors.length).length,
      duplicateGroups: updates.filter((r) => r.duplicateCandidates.length > 1)
        .length,
      lastSync,
    };
  });
}
function resolveDuplicate(request) {
  const actor = actor_(true);
  if (
    !request ||
    clean_(request.reason).length < 5 ||
    clean_(request.reason).length > 300
  )
    throw new Error("Explain the response selection in 5–300 characters.");
  return locked_(() => {
    const r = read_("Registrations").find((x) => x.id === request.id);
    if (!r || r.inactive || r.sourceMissing || !r.duplicateCandidates?.length)
      throw new Error("No active duplicate group for this registration.");
    if (r.groupKey !== request.groupKey || r.revision !== request.revision)
      throw new Error("Responses changed. Refresh before reviewing.");
    const candidate = r.duplicateCandidates.find(
      (c) => c.key === request.candidateKey,
    );
    if (!candidate) throw new Error("Select one of the displayed responses.");
    if (candidate.errors.length)
      throw new Error(
        "Selected response has invalid fields. Correct the source and refresh first.",
      );
    const decision = {
      groupKey: r.groupKey,
      candidateKey: candidate.key,
      reason: clean_(request.reason),
      actor,
      reviewedAt: now_(),
    };
    r.duplicateReviewHistory = (r.duplicateReviewHistory || []).concat(
      decision,
    );
    r.duplicateReview = decision;
    r.reviewRequired = false;
    r.errors = candidate.errors.slice();
    Object.assign(r, {
      name: candidate.name,
      phone: candidate.phone,
      phoneSearch: candidate.phoneSearch,
      householdSize: candidate.householdSize,
      sourceSubmittedAt: candidate.submittedAt,
      sourceRow: candidate.sourceRow,
    });
    r.fingerprint = JSON.stringify([
      candidate.key,
      r.groupKey,
      candidate.key,
      r.eventId,
    ]);
    r.revision++;
    save_("Registrations", r);
    return {
      id: r.id,
      revision: r.revision,
      message:
        "Response selected. Arrival and print history preserved; nothing was printed.",
    };
  });
}
