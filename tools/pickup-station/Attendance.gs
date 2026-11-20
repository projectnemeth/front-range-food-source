/* Optional attendance mirror. The only source-workbook writes are to this dedicated tab. */
const ATTENDANCE_TAB_ = "FRFS Attendance";
const ATTENDANCE_HEADERS_ = [
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
function syncAttendanceToSource() {
  actor_(true);
  return attendanceMirror_();
}
function attendanceOwner_() {
  const email = String(
    Session.getEffectiveUser().getEmail() || "",
  ).toLowerCase();
  if (
    !config_()
      .admins.map((x) => x.toLowerCase())
      .includes(email)
  )
    throw new Error(
      "Attendance trigger owner must be an authorized coordinator.",
    );
}
function installAttendanceSync() {
  actor_(true);
  attendanceOwner_();
  // Verify permissions and destination before installing anything.
  const result = attendanceMirror_();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "scheduledAttendance_")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("scheduledAttendance_")
    .timeBased()
    .everyMinutes(5)
    .create();
  return {
    ...result,
    message:
      result.message +
      " Automatic attendance sync enabled every five minutes under this coordinator account. Install it under one maintained account only.",
  };
}
function scheduledAttendance_() {
  attendanceOwner_();
  return attendanceMirror_();
}
function attendanceCell_(value) {
  // Export text as text, even when a name/phone/vehicle resembles a Sheets formula.
  const text = value == null ? "" : String(value);
  return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
}
function attendanceMirror_() {
  try {
    return locked_(() => {
      const c = config_();
      if (
        c.source?.type !== "sheets" ||
        !c.source.spreadsheetId ||
        c.source.spreadsheetId === c.sheetId
      )
        throw new Error(
          "Attendance export requires separate source and working spreadsheets.",
        );
      const records = read_("Registrations").filter(
        (r) => !r.inactive || r.checkedInAt,
      );
      if (!records.length)
        throw new Error("Import registrations before exporting attendance.");
      const book = SpreadsheetApp.openById(c.source.spreadsheetId);
      let tab = book.getSheetByName(ATTENDANCE_TAB_);
      let prior = [];
      if (tab && tab.getLastRow()) {
        if (
          tab.getLastRow() > 10001 ||
          tab.getLastColumn() !== ATTENDANCE_HEADERS_.length
        )
          throw new Error(
            "FRFS Attendance has an unexpected layout or exceeds 10,000 records. No attendance cells changed.",
          );
        const values = tab
          .getRange(1, 1, tab.getLastRow(), ATTENDANCE_HEADERS_.length)
          .getValues();
        if (JSON.stringify(values[0]) !== JSON.stringify(ATTENDANCE_HEADERS_))
          throw new Error(
            "FRFS Attendance already contains a different layout. Rename it before enabling export. No attendance cells changed.",
          );
        prior = values.slice(1).filter((row) => row[0]);
      }
      const byId = new Map();
      for (const row of prior) {
        if (byId.has(String(row[0])))
          throw new Error(
            "Duplicate registration IDs in FRFS Attendance. Review the tab before syncing.",
          );
        byId.set(String(row[0]), row);
      }
      const stamp = now_();
      for (const r of records) {
        const event = c.events.find((e) => e.id === r.eventId);
        const row = [
          r.id,
          r.eventId,
          event?.label || r.eventId,
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
          r.reviewRequired || r.errors?.length ? "Yes" : "No",
          stamp,
        ].map(attendanceCell_);
        byId.set(String(r.id), row);
      }
      if (byId.size > 10000)
        throw new Error(
          "Attendance export exceeds 10,000 records; archive before syncing.",
        );
      if (!tab) tab = book.insertSheet(ATTENDANCE_TAB_);
      const output = [ATTENDANCE_HEADERS_, ...byId.values()];
      if (tab.getMaxRows() < output.length)
        tab.insertRowsAfter(tab.getMaxRows(), output.length - tab.getMaxRows());
      if (tab.getMaxColumns() < ATTENDANCE_HEADERS_.length)
        tab.insertColumnsAfter(
          tab.getMaxColumns(),
          ATTENDANCE_HEADERS_.length - tab.getMaxColumns(),
        );
      tab
        .getRange(1, 1, output.length, ATTENDANCE_HEADERS_.length)
        .setValues(output);
      SpreadsheetApp.flush();
      const props = PropertiesService.getScriptProperties();
      props.setProperty("LAST_ATTENDANCE_SYNC", stamp);
      props.setProperty("ATTENDANCE_SYNC_ERROR", "");
      return {
        rows: byId.size,
        lastSync: stamp,
        message:
          "Attendance saved to FRFS Attendance in the original workbook (" +
          byId.size +
          " records). Expected means no check-in recorded; Arrived means checked in. Prior exported events are retained.",
      };
    });
  } catch (e) {
    PropertiesService.getScriptProperties().setProperty(
      "ATTENDANCE_SYNC_ERROR",
      "Attendance sync failed. Review permissions, destination layout and Apps Script Executions, then retry. Check-ins and print jobs remain saved.",
    );
    throw e;
  }
}
