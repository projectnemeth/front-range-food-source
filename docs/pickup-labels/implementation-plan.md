# Pickup labels: implementation plan

Prepared: November 4, 2026  
Companion: [Phase-one specification](phase-one-spec.md)

## Current implementation status

A standalone Apps Script pilot is implemented in [tools/pickup-station](../../tools/pickup-station/README.md). The selected primary workflow is **Check in & print** from a mobile iPad to the fixed packing station. The app now includes a packing-station arrival view, attention filters, safe resume of never-dispatched jobs, and simulated failures in the fictional-data demo. The sheet adapter now matches the verified response headers and includes coordinator review for repeated IDs. The coordinator setup screen can enable verified pickup tabs and preview imports. Manual print-service diagnostics show queue delivery/error/expiry without resending or claiming physical output. Fifty-two automated server and in-memory-DOM workflow tests cover arrivals, duplicate/retried requests, interrupted writes, print errors, source revisions, authorization, and ZPL escaping. Google deployment, coordinator accounts and device enrollment, live source access, Windows client setup, and physical printer tests are outstanding. Milestone completion still requires those real-system gates; local code does not satisfy the hardware milestone.

## Delivery approach

Build the smallest complete path from existing registration to a physical adhesive label, then add reliable batch handling. Keep phase one independent of the existing food-order application's deployment. The planning files live with project documentation for future handoff; they do not implement or publish an integration.

Do not commit to a transport until milestone 1 passes. The current church check-in app is not a general-purpose printing app. Evaluate an existing print service/client on the confirmed Windows PC first, and build the food-pickup interface around the proven connection. If no computer is available, assess a compatible iPad printing app with a documented integration before estimating native development.

## Milestone 1 — Prove printing on the actual equipment

Owner: developer with an on-site coordinator. Planning allowance: 0.5–1 working day once equipment is available.

Tasks:

1. Record the identified ZD421 and GX420d, confirm which is USB versus Wi-Fi, and record Windows/iPadOS versions, stock size, resolution, and printer queue names. The USB-connected Windows PC is the initial print station.
2. Observe the church check-in printing flow and identify every intermediary. Record the software name and whether a computer, appliance, or direct connection is used. Do not assume that software exposes an external print API.
3. Prepare fictional data: a short name, long name, accented name, international-format phone, and two-digit household count.
4. Print one label, then ten different registrations with three copies each. Test reconnecting the printer, canceling a print action, and running out of labels partway through a batch.
5. Record time to first label, total batch time, taps required, output ordering, sizing, and success/status visibility.
6. Test an existing print service/client, such as PrintNode, on the existing Windows PC using our own test request. Begin with the USB printer and RAW ZPL. Add the Wi-Fi printer as a separate Windows queue if reachable from this PC; test both destinations separately with their own resolution/stock profiles. Verify restart recovery and visibility under the actual client/service account. Verify the actual printer, label format, credentials, connectivity, and licensing. If no computer is available, test a newly selected iPad app integration. Estimate custom bridge or native development only if existing products do not fit.

Deliverable: a short hardware decision record, tested label dimensions, photos retained by staff if helpful, and the selected file/transport contract.

Exit gate: physical labels pass the specification's feasibility gate. A preview or PDF generation alone is not sufficient.

## Milestone 2 — Connect and validate existing responses

Owner: developer; coordinator confirms mapping and event assignment. Allowance: 1–2 working days.

Tasks:

1. Get authorized access to the existing Form and/or linked response sheet. Inspect exact questions and a small authorized sample without copying unrelated answers.
2. Map name, phone, household size, and event. Resolve how older responses map to pickup events.
3. Create a separate working spreadsheet with tabs for Settings, Events, Registrations, PrintJobs, and PrintJobItems. Protect operational tabs against ordinary manual editing.
4. Implement stable source IDs, initial import, source revision tracking, validation, and a review queue.
5. Add a maintained-account submission trigger and manual refresh/reconciliation. Show last successful refresh and actionable errors.
6. Prove device enrollment, persistent iPad authorization, and revocation without volunteer sign-in. Use the separate deployments in the README; use a separately hosted backend if Workspace policy or browser storage prevents this flow.

Suggested registration fields: internal ID, source kind/key, event ID, name, phone display/search forms, household size, source revision, validation state, correction provenance, check-in timestamp, last imported timestamp.

Exit gate: importing the same source twice does not duplicate records; source edits update the current record; historical entries are assigned correctly; a denied account gets no contact data.

## Milestone 3 — Deliver the single-household workflow

Owner: developer with volunteer feedback. Allowance: 1–2 working days after transport is proven.

Tasks:

1. Build a touch-friendly event selector, search results, registration detail, and label preview.
2. Implement the tested label profile and output format. Set explicit dimensions, margins, encoding, and copy count.
3. Add a **Print labels** action and the verified server-to-print-service connection or selected app handoff. Keep service credentials server-side; enforce the configured printer and permitted copy limits. Label any required app-switching step clearly.
4. Record immutable job snapshots and request tokens. Protect job creation against retries and concurrent requests using a server-side lock.
5. Implement submitted/confirmed/unknown/failed states and deliberate reprints.
6. Keep check-in independent of printing. Indicate existing prepared labels so volunteers can use them without printing again.

Exit gate: a volunteer can locate and print the correct household without retyping the three fields. Run the timing targets on the real iPad.

## Milestone 4 — Add advance batches and recovery

Owner: developer and pickup coordinator. Allowance: 1–2 working days.

Tasks:

1. Add selection, valid/review counts, total-label preview, copies per registration, and deterministic grouping/order.
2. Freeze source revisions at batch creation. Warn if responses change before a later print attempt.
3. Add **New or changed registrations**, explicit reprints, small batch chunks, and per-registration recovery records.
4. Show a warning before reprinting previously submitted or confirmed labels. Never automatically retry outcome-unknown physical output.
5. Implement CSV export for contingency if useful; include an explicit schema and safe text handling. Add a sheet-label PDF only if staff selects exact stock and an office printer; this is optional additional scope.
6. If using an existing print service, persist its job IDs and map its documented statuses to ours. Reconcile uncertain submissions rather than resending blindly; validate any provider idempotency mechanism. Monitor client availability and document how to restart it. If building a custom computer bridge, implement authenticated job retrieval, one active claimant per job, bounded retries before dispatch, heartbeat/status, and operator reconciliation after uncertain dispatch. Do not release an expired claim for automatic reprint after bytes may have reached the printer.

Exit gate: advance batches and check-in prints share the same registration state; a partial batch can be reconciled and resumed without silently duplicating completed labels.

## Milestone 5 — Pilot a pickup and hand over

Owner: coordinator and developer. Allowance: 0.5–1 development day plus the scheduled pickup pilot.

Before the event:

- Refresh and review registrations, print a test label, confirm label supply, charge the iPad, and test the site connection.
- Prepare an authorized backup roster or advance labels; assign a person to printer troubleshooting.
- Train volunteers on finding the right household, copies, existing labels, check-in, and unknown print outcomes.

During the pilot:

- Start with one printing station; test two iPads concurrently only if that is part of the intended deployment.
- Record lookup and print times, manual corrections, reprints, jams, and instances requiring handwriting. Compare with a small sample of the current process.
- Observe whether three labels actually help. Change the default copy count based on use.

After the pilot:

- Resolve operational defects, document setup/reconnect/reprint steps, name the ongoing owner, and configure agreed retention/cleanup.
- Record the final working hardware configuration and deployment details for phase-two integration.

Exit gate: the coordinator accepts the workflow and the mandatory acceptance criteria pass. Keep the previous paper process available until the pilot demonstrates reliability.

## Verification matrix

| Scenario | Expected evidence |
| --- | --- |
| Existing and new registrations | Correct event and values; repeated import creates no duplicates |
| Header/question mapping change | Visible setup error; no silent mislabeling |
| Long/accented names and unusual phones | Physical output is legible and accurate |
| Missing phone or invalid household count | Review or explicit exception; no invented value |
| Two same-name people and repeat submissions | Separate records; staff can select correctly |
| Same person at two events | Correct event isolation and printing history |
| Double tap and concurrent staff actions | One job for a repeated request token; prior submissions shown |
| One/two/three copies and batch grouping | Count and sequence match preview |
| Canceled handoff, dropped connection, paper-out | Honest status; no blind retry after uncertain output |
| Source changes after printing | Current revision flagged for review/reprint; old snapshot preserved |
| Unauthorized user/API request | No personal data or print access |
| Network outage | Clear unavailable/stale status and usable prepared fallback |

Use small automated checks for mapping, validation, revision/idempotency logic, and output escaping. Hardware, fit, scanning the results by eye, app switching, and timing require physical tests. Do not use software tests as substitutes for printing.

## Effort and operating costs

For a familiar developer, a proven existing print-service integration or app handoff and straightforward Google access could place the custom MVP at approximately 4–8 development days after hardware discovery, plus the pickup pilot. The previous assumption of an existing general-purpose iPad printing app is withdrawn; this estimate remains conditional until a replacement printing route is proven. This is a planning estimate, not a quote. A CSV/template-only pilot may take considerably less work. A new print bridge, authentication backend, or native iPad app requires a separate estimate.

Budget categories: adhesive stock, any existing/new label-app license, developer time, optional always-on computer/hosting, and ongoing support ownership. Verify actual license and hardware prices after selecting the transport. Do not assume Google account quotas or third-party printing services make unlimited volume free.

## First implementation session

Confirm which of the ZD421/GX420d printers uses USB versus Wi-Fi, the existing Windows PC’s version and availability during pickup, church software name, stock dimensions, and source Form/sheet access. First prove a Windows print to the USB device, then a service/API print, then an iPad-initiated print. Extend to the Wi-Fi printer after checking PC-to-printer connectivity. Use fictional data to print the three-field sample. Record the proven route, then implement historical import and a single **Find household → Print labels** flow. Complete batch support before considering phase one finished, since both modes are required.
