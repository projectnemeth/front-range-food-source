# Front Range Food Source pickup station

Standalone phase-one pilot implementation. A volunteer finds an existing registration on an iPad and selects **Check in & print**. Arrival and a print-job snapshot are saved to a working Google Sheet; Apps Script sends the label to PrintNode, whose client on a configured Mac or Windows computer delivers it to the configured Zebra queue.

**Status:** local implementation with automated service mocks. Not deployed, connected to a real Form, or physically printer-tested. The device authorization model, label fit/encoding, and site network must pass the pilot before live use. The existing Next.js/Firebase app is untouched.

## Included

- Name/phone search, event selection, household detail, and three-field label preview.
- Atomic-under-script-lock check-in/job creation with crash recovery; repeated arrival requests from separate iPads reuse the existing arrival job.
- One to three copies, explicitly reasoned reprints, and advance printing in batches of up to 50 households. Advance labels do not mark arrival; a subsequent arrival normally prints a new set for the packing team.
- Honest Submitted / Failed / Outcome unknown / Confirmed by staff states. A timeout is never automatically reprinted. Successful cloud submission is not physical confirmation.
- Read-only Google Sheet import using the verified headers, with explicit pickup-tab mapping by numeric tab ID. Sorting rows does not change registration identity.
- Repeated-ID review: one held group per ID and pickup; a coordinator chooses the response, records a reason, and releases it for check-in/printing. Changed response groups invalidate old decisions on the next refresh. No automatic “latest response wins” rule.
- Direct Form import remains an alternative. Both adapters support manual reconciliation and optional five-minute refresh.
- Revocable church-iPad enrollment and coordinator-only setup/import; server-side PrintNode secret and UTF-8 hex-escaped ZPL.
- Separate car-line and packing-station views, expected/arrived/needs-attention filters, and accent-insensitive name search.
- Packing-station arrivals in oldest-first order, manual physical-print confirmation, and safe resume for saved jobs that have never been dispatched.
- Automatic print follow-up for sites with no packing screen: about 15 and 40 seconds after Check in & print (or a reprint/resume), the iPad reads the print-service status. If the service reports an error/expiry, or the print computer still has not picked up the job, a pinned **Label problem** alert names the household on that iPad until dismissed. A stalled job also appears under Needs attention. The follow-up never resends; it cannot detect paper-out or jams after the print computer has the job.
- Car-line arrival details: each iPad chooses **Blue line** or **Orange line** once (remembered on that iPad, changeable any time). Check-in requires a 3-digit number entered on an on-screen keypad (no system keyboard) and accepts an optional vehicle description (≤30 characters, with color/type quick picks). The arrival label adds a large `#123` and the line in a box (ORANGE printed white-on-black so lines differ at a glance) plus the vehicle line. Reprints after arrival reuse these details unless corrected under Other actions. Advance labels omit them. A repeated number in the same pickup asks for confirmation.
- **Pre-Packed walk-ups:** households that did not pre-register can be added from the car line with **+ Pre-Packed walk-up** (or the "Not registered?" button when a search finds no one). Name and household size are required, phone is optional ("No phone" prints), and the usual line, 3-digit number and vehicle apply. The household is added, checked in and printed in one step; the label carries a white-on-black **PRE-PACKED PICKUP** bar. Walk-ups live only in the working sheet, are marked Pre-Packed in lists and the packing view, and are never changed or hidden by source refreshes. Retries reuse a request token, so a double tap or dropped connection cannot add the household twice.
- Idle refresh every 30 seconds while the page is visible, preserving copy selections, keypad entries and reprint drafts. Background refresh no longer disables (greys out) the screen, and an older read can never overwrite a newer one. The app does not refresh while a text field or select is focused; staff can always refresh manually.
- Coordinator setup checklist with verified source-tab selection, pickup activation, working-storage initialization, and import preview. Activation changes only app configuration; it does not import or print.
- Manual print-service diagnostics for jobs with known provider IDs. Queue delivery is distinguished from physical label confirmation; checking status never resends.
- Fictional-data browser demo with normal, rejected, and uncertain print outcomes, setup rehearsal, and service-status simulation. It cannot send real print requests.

## Files and local checks

- `Code.gs`: Apps Script server, direct-Form adapter, storage, ZPL renderer, and PrintNode transport.
- `Sheets.gs`: read-only source-sheet adapter, tab preview, and duplicate-review decisions.
- `Access.gs`: device enrollment, authorization, and revocation.
- `Attendance.gs`: optional attendance mirror in the original workbook and scheduled export.
- `Operations.gs`: coordinator setup and read-only print-service job diagnostics.
- `Index.html`: iPad interface; demo mode when opened outside Apps Script.
- `appsscript.json`: runtime and OAuth scopes.
- `config.sheet.example.json`: verified sheet mapping with historical event disabled; no credentials.
- `config.example.json`: alternative direct-Form configuration.
- `tests/station.test.cjs`: Node's built-in test runner with in-memory Google/PrintNode mocks.

Run `npm test` in this directory. Run `npm run package` to run the tests and rebuild the deployment ZIP with a SHA-256 file manifest. No dependency installation is required. To view fictional data, run `npm run preview` and open `http://localhost:8765/Index.html`, or open `Index.html` directly in a browser. The prominent DEMO banner distinguishes that mode from the deployed app. Demo state resets on reload and is not a real database or a print test.

## Verification performed

All 83 automated tests pass: 55 server/service tests and twenty-eight client workflow tests using an in-memory DOM. On November 5, 2026 the demo was also checked in headless Chromium at iPad portrait/landscape and phone sizes: no script errors, no horizontal scrolling, and the print alert stays pinned while the volunteer works on the next household. The DOM tests check actual client code but do not render a browser or establish visual correctness. The HTML client script also passes a JavaScript syntax check within that suite. Headless Chromium is not iPad Safari: confirm layout, the on-screen keypad and saved setup on the real iPads. No live Google or PrintNode calls were made by the tests.

## Google deployment — sheet source

1. Under a maintained coordinator Google account, create a **new standalone Apps Script project** and a **separate working Google Sheet**. Do not bind the script to a sheet shared with volunteers: script editors can access script properties and the printing secret.
2. Copy `Code.gs`, `Sheets.gs`, `Operations.gs`, `Access.gs`, `Attendance.gs`, `Index.html` (HTML file named `Index`), and `appsscript.json` into the project. All seven files are required. Enable showing the manifest in project settings if necessary.
3. Set the script property `CONFIG` using `config.sheet.example.json`. The column mapping is already filled from read-only inspection; replace `SOURCE_RESPONSE_SPREADSHEET_ID` with the response sheet's ID and set the example event's `sourceSheetId` to the pickup tab's numeric ID (or enable the tab from **Check setup**). Real IDs, coordinator emails and a copy of the live CONFIG belong in an untracked `config.json`, never in the repository, which is public. Set `sheetId` to the **new working spreadsheet**, never the original response sheet; the code rejects a matching source and working ID.
4. Choose the actual pilot pickup event. The sample includes the observed October 17, 2026 tab **disabled**, because it is historical. After deployment, use **Coordinator tools → Check setup** to select a verified tab, enter its pickup label, and explicitly enable it. Alternatively, run `inspectSourceTabs()` in the editor to obtain tab IDs and configure the event there. A tab's title can change without changing identity. Do not reuse a previously imported tab for a different event.
5. Set `authMode` to `devices`, leave `staff` empty, and enter coordinator Google emails in `admins`, then the PrintNode printer ID, measured stock size, and DPI. Put the PrintNode service credential in a **separate script property** `PRINTNODE_API_KEY`, never in the HTML, spreadsheet, repository, or chat. Import/duplicate review can be tested before the printer is configured.
6. Run `setupStation()` to initialize the working sheet, or use **Initialize working storage** in the deployed coordinator setup screen. Use **Preview source import** to inspect counts before saving registrations, then **Refresh source data** to import. The corresponding editor functions are `previewSheetImport()` and `syncResponses()`. Editor function return values can be displayed with a temporary editor-only logging wrapper; log summaries only, not client data or credentials.
7. Check the imported event and **Needs attention** filter. Repeated IDs are held until a coordinator reviews the displayed candidates and chooses a response with a reason. If the same ID actually belongs to different households, fix the IDs in the source using your existing coordinator process; do not select one household and discard another. The app does not write those corrections to the source.
8. Create two deployments from the same script version. **Coordinator:** execute as the accessing user, require Google sign-in, and open with `?coordinator=1`. Only `admins` emails can use it; coordinators need source/working-sheet permissions. **Staff:** execute as the maintained owner, with access allowing no Google sign-in (often named “Anyone”). The public page contains only the enrollment shell; data and printing require an enrolled-device token. Keep both sheets private to coordinators. Volunteers need no Google account or spreadsheet permissions.
9. On the coordinator page, create a 4-digit setup PIN for a named iPad. Enter it on the staff URL on that iPad. PINs work once and expire after 15 minutes; five wrong PINs in a row cancel every PIN still waiting to be used, so a coordinator issues a new one. The browser stores a token; the server stores only its hash. Sessions default to 180 days (`deviceSessionDays`, range 1–365). Expiry, cleared storage, or revocation requires re-enrollment. Coordinator device controls can revoke a lost iPad; already submitted printing cannot be canceled this way. Audit records identify devices, not individual volunteers. Keep the coordinator account off shared iPads.
10. Optionally run `installSyncTrigger()` once under the maintained coordinator. It reconciles every five minutes. Do not install it under several accounts. Manual **Refresh source data** remains available to coordinators. Trigger failure leaves the last successful import timestamp unchanged; monitor Apps Script Executions.
11. Save the staff URL to the enrolled iPads and packing-station laptop; enroll that browser too. Confirm real connectivity throughout the car line. Offline check-in is not implemented.

The setup screen does not edit staff allowlists, source-workbook IDs, printer IDs, or credentials; those remain coordinator-controlled project properties. It refuses stale configuration changes from a second session. No accounts, subscriptions, sharing permissions, or Google working resources have been created by the local build. The original response spreadsheet has only been read, never changed.

### Required device-access pilot

Before real data is imported, verify that an unpaired signed-out browser sees only enrollment, tokenless staff calls fail, and device tokens cannot invoke coordinator controls. Test allowed/denied coordinator accounts, two iPads, code reuse rejection, and revocation. Close/reopen Safari and the actual saved shortcut to verify storage persists. Do not use private browsing.

Apps Script iframe storage persistence and Workspace anonymous-deployment policy still need live validation. If either prevents this flow, use a separately hosted backend with device authentication; do not remove authorization or make sheets public. Coordinator checks use the active user, never the effective owner. See [Google web-app identity](https://developers.google.com/apps-script/guides/web) and [Session restrictions](https://developers.google.com/apps-script/reference/base/session).

### Source identity and import behavior

A registration is keyed by **source spreadsheet ID + numeric tab ID + trimmed ID#**. That is a household review group, not an assumption that every ID identifies a unique response. The adapter imports only one held record when an ID has multiple responses; it never silently prints all of them or selects the newest. The submission timestamp helps staff compare candidates but is not used as durable identity.

Keep ID# stable during pickup. Editing a name/phone/count or submission timestamp updates the revision without changing the household key. Sorting rows changes only the source row reference. Moving a record to another tab or changing ID# changes its identity and must be reconciled manually if arrival/printing already occurred.

The list ends at the **last row with a name**; rows below it (totals, notes) are ignored and counted in the preview, so tabs of any length work without configuration. A nameless row inside the list is still imported and flagged for review rather than ending the list. Missing IDs inside the list, ambiguous/missing headers, oversized imports, and a previously populated tab becoming completely empty stop the refresh before registration changes. When a source household disappears after arrival, it stays visible with a review warning rather than losing its arrival history. A removed, not-yet-arrived household becomes inactive. Review decisions and print jobs are retained in the working sheet.

The adapter reads headers and only the columns through the last mapped field; for the verified layout, that is A–E. It does not need the demographic columns after household total. Phone and identifier values are read as displayed text.

### Alternative: direct Google Form source

Use `config.example.json` instead, with the Form ID and item IDs from `inspectFormFields()`. That adapter expects one full-name, phone, total-household, and event question. Coordinator access to the Form is required. Do not switch source adapters over a live pickup's working records without a deliberate migration; create a separate working sheet for a new pilot source.

## Laptop and Zebra setup

1. Choose the pilot Mac or Windows laptop (or another available station computer). Confirm its supported OS and printer setup. Identify the chosen ZD421 or GX420d, connect it by USB or install its reachable network queue, and confirm printing independently of church software. Record working settings before changing anything.
2. Set up the appropriate PrintNode account/client on that computer following the vendor's instructions. Confirm its OS/driver compatibility and the account/service context that sees the printer. Keep the laptop plugged in, awake, and online through pickup, including after restart. Do not assume closing its lid will keep printing running.
3. Obtain the target **PrintNode printer ID**. This is not the operating system’s printer queue name. Enter it in CONFIG with the measured label width/height and printer DPI. Label text scales to fill the configured size (width 1.5–4.1 in, height 1–4 in), so these values must match the real stock and printer resolution; a 300 dpi printer configured as 203 dpi prints everything about a third smaller. GX420d is 203 dpi; verify the installed ZD421 resolution. The supplied 3 × 2 inch / 203 dpi profile is a placeholder, not a measurement from the photos.
4. Start with one designated packing printer. The app sends each job to that configured destination; it does not broadcast or automatically fail over. To use the Wi-Fi printer later, first install/test its queue from the same PC and change the configured printer/profile between pickup sessions.
5. Print fictional names first, including accents, a long name, phone extensions, and a two-digit household. The renderer uses ZPL `^CI28` with hexadecimal UTF-8 field data. Actual firmware/font support must be verified, particularly on the older GX420d. If needed, replace the renderer with a verified raster/PDF workflow; never silently strip accents or truncate names.
6. Native ZPL `^PQ` supplies the copy count; PrintNode `qty` remains 1. No driver-based copy multiplier is applied. Check exact dimensions and label sensing to avoid blank labels.
7. PrintNode jobs expire after 120 seconds if they cannot be printed immediately. This reduces stale kitchen tickets after a disconnected station reconnects. It is not a guarantee that a job already in the Windows spooler is canceled. Check both service and Windows queues before reprinting an uncertain job.

## Pickup-day flow

The packing-station screen is optional. With two car-line iPads and no packing screen, printed labels are the packers' only signal: assign one packer to own the printer and spare label rolls, and volunteers act on any **Label problem** alert by checking with that packer before reprinting.


1. Coordinator refreshes the source, resolves missing fields, tests the printer, and verifies the event.
2. Volunteer searches on the iPad, confirms name/phone/household, and taps **Check in & print**.
3. The label appears at the packing station. Staff attach it to the paperwork/box and begin packing. Volunteers remain at the cars; no label needs to travel back to the iPad.
4. There is no physical-print confirmation step: volunteers never need to see the printer. The automatic follow-up warns the iPad if the print computer does not pick up a job or the service reports an error.
5. Use **Packing station** on the station computer or an iPad to see arrivals and label problems. Advance batches stay out of this arrival view. Physical print confirmation does not mark a box completed.
6. If printing fails, the arrival remains recorded. Check the station, then use **Other actions → Reprint labels** with a reason. Do not tap reprint merely because an iPad lost its connection.
7. **Check in without printing** remains available for already-prepared labels, missing data, or a coordinated paper fallback. This path produces no printed notification. It appears in the packing-station view as **No arrival label**, but staff should communicate the arrival directly rather than assume someone is watching the screen.

## Pilot limits and remaining validation

- Sheet and direct-Form adapters are available; CSV import is not. Identity edits or changing source adapters during an active pickup require coordinator reconciliation.
- One configured printer per deployment; no station selector or automatic failover. Sheet mode uses explicitly mapped pickup tabs; direct-Form mode requires an event question.
- Reconciliation capped at 2,000 source rows/responses across the active source; sheet-backed reads/job history grow with usage. Measure at expected volume and archive old events before expanding. Tests cover mock services, not real multi-user Google execution or quotas.
- No automatic provider-status polling. **Check service status** makes a read-only request for a known provider job ID; results are reused for 15 seconds. Submitted means API-accepted; Sending older than two minutes displays Outcome unknown. PrintNode `done` means delivery to the laptop operating-system queue, not physical output. Error/expired service states appear as attention items unless staff already confirmed the physical labels. No status check causes a resend. Physical confirmation remains manual. A job left Prepared by a crash can use **Resume saved job** without making another job. Resume will not resend Failed, Submitted, or Outcome unknown jobs.
- PrintNode's idempotency header is added as defense in depth. Local durable jobs prevent automatic retry after uncertain dispatch; do not rely on the provider's 24-hour idempotency window as long-term duplicate protection.
- Automatic data retention cleanup is not implemented. Agree a retention period and use coordinator-managed archival/deletion of working records and provider history. Original Form retention is a separate policy.
- No direct label sheet/PDF export, packing-complete workflow, vehicle notes, SMS, or phase-two order-system integration.
- Site-network reach, print latency, readable physical output, station-computer restart behavior, device enrollment and revocation, and live Google integration remain mandatory on-site/deployment checks.

## References

- [PrintNode API](https://www.printnode.com/en/docs/api/curl): RAW payloads, job expiration, and idempotency behavior.
- [PrintNode Windows/network printing](https://www.printnode.com/en/faq).
- [Apps Script web-app identity](https://developers.google.com/apps-script/guides/web).
- [Google FormResponse IDs](https://developers.google.com/apps-script/reference/forms/form-response).

## November 20 update — pre-packed reasons and latest-tab import

Build `2026-11-20.1` adds mutually exclusive **No Show** / **Walk Up** checkboxes to the Pre-Packed Pickup form and an optional Pre-Packed section on existing expected households. No Show means **Previous No-Show**: successful check-in records today's arrival, excludes the household from Expected, and retains the previous-no-show badge in the pickup list, details, and packing view. It does not mark someone absent today. Walk Up is the default for new pre-packed entries. Both reasons use the existing pre-packed label bar. Source refreshes preserve the selection, and interrupted arrival writes recover the reason from the saved print job.

The inspected latest response tab has a blank A1 where the Date header normally appears. The importer now accepts a blank first header as Date only when the configured timestamp header is exactly Date and no Date header already exists; other missing or ambiguous headers still fail. Import preview explicitly reports this assumption. No source cells are edited. The empty-event message now distinguishes refreshing the saved list from importing source responses.

To install: replace **Code.gs**, **Sheets.gs**, and **Index.html** in the existing Apps Script project. Update **both** staff and coordinator deployments to a new version, then reload the app (build stamp `2026-11-20.1`). In Coordinator tools select the intended tab, preview the import, then use **Refresh source data**. Enabling an event alone does not import households. Other source data validation/repeated-ID review still applies. Keep existing CONFIG and PRINTNODE_API_KEY; no new properties or schema migration are required.

Validation: 90 automated tests using mocked services and an in-memory DOM. The tests cover blank-header import, required-header rejection, previous-no-show arrival/persistence, interrupted-write recovery, exclusive checkboxes, packing visibility, and the Expected filter. Live deployment and physical output are not verified by these tests.

## Previous No-Show filter — build 2026-11-20.2

The **Show households** dropdown now includes **Previous No-Show** alongside Expected, Arrived, and Needs attention. It selects saved previous-no-show classifications while preserving today's arrival status and normal name/phone search. Both the boolean flag and saved `prepackedReason: noShow` are recognized. Existing marked households need no migration or re-entry. The packing view continues to show all arrivals independently of the pickup-list filter.

Replace Index.html and Code.gs and update both existing deployments to a new version; reload and verify build 2026-11-20.2. No Script Property changes or source re-import are needed for this filter. The deployment bundle includes the earlier latest-tab import fix too.

## Build 2026-11-20.3 — access resilience and attendance history

**Local only; not deployed or written to a live workbook by this update.** 99 automated tests pass. Tests include rolling device access, actual expiry/revocation, a transient startup error, session-storage fallback, attendance export, formula escaping, preserving prior exported events, and failed/unauthorized writes.

### iPad access

The setup PIN remains single-use and valid for 15 minutes; that is separate from the enrolled device's session. Valid device sessions now renew for `deviceSessionDays` (default 180) on successful use, with server writes limited to once per day. Expired or revoked sessions cannot renew. Local storage remains the persistent browser credential, with session storage as a same-tab reload fallback. Connection/service failures preserve credentials and show a reconnect message instead of an enrollment screen. The iPad device list includes last-seen time in its response for diagnostics.

An hour-long logout has not been reproduced on real equipment. Safari/private browsing, clearing site storage, a different browser/shortcut, a changed Apps Script deployment URL, and Apps Script iframe storage can still lose browser authorization. This patch cannot guarantee weeks of persistence under those conditions. Use the same existing staff `/exec` URL, outside Private Browsing; update existing deployments rather than creating new ones. A stable first-party hosted site with persistent server cookies is the recommended longer-term fix.

### Attendance in the original workbook

Until enabled, statuses remain in the separate working workbook. Expected is derived from no `checkedInAt`; Arrived is derived from a saved timestamp. Previous No-Show is independent history. Needs attention also includes current printing/data problems; it is not itself attendance.

After deployment, open **Coordinator tools → Attendance history in Google Sheets**. **Sync attendance now** creates/updates `FRFS Attendance` in the configured original response workbook. **Enable five-minute attendance sync** performs a first export, verifies permission, and installs a coordinator-owned scheduled trigger. The coordinator needs Editor access to the original workbook. Install under one maintained account only. Staff iPads cannot call these coordinator methods. Source response tabs/columns remain untouched by the export.

Each row is keyed by the original registration ID, not a remembered row number or name, and includes event ID/name, source ID/tab, name, phone, household size, Expected/Arrived, UTC check-in timestamp, Previous No-Show, pre-packed reason, car number/line/vehicle, source-review flag, and export time. Walk-ups are included. Re-export updates the same row; previously exported records remain if no longer in working storage. Conflicting pre-existing destination headers and duplicate destination IDs stop the export. Do not edit this app-owned mirror manually or rename its columns. Working data remains authoritative; changing the mirror does not change the app. Do not import the attendance tab as a pickup event.

Export runs separately from printing and check-in. No source permission error can roll back a saved arrival or cause an automatic reprint. View export errors/last export time in **Check setup**. Failed scheduled runs retry on the next scheduled run; perform a manual final export after pickup and verify its timestamp/counts before archiving working records. No individual historical attendance can be reconstructed if it was never recorded. Expected after pickup means no recorded check-in; the current pilot does not automatically close events and relabel those households No Show.

### Installing this build

Replace Code.gs, Access.gs, Operations.gs and Index.html; add **Attendance.gs** as a new script file. Keep the latest Sheets.gs (the bundle includes the previous import fix). Update both existing deployments to a new version and verify `2026-11-20.3`. No new secrets or CONFIG fields are required. The attendance export is opt-in using the coordinator buttons. See the repository's hosted migration plan for the normal-webpage replacement.
