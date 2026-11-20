# Pickup app: stable website and attendance history

Decision brief, November 20, 2026. Proposed hosted architecture; no hosted migration, database creation, deployment, or live workbook writes have been performed by this update.

## Recommendation

Move staff and coordinator screens to one normal website on Vercel. Keep PrintNode on the Mac and the working Wi-Fi ZD421 setup. Keep Google Forms/Sheets as the registration source and give coordinators an attendance mirror in the original workbook.

The existing repository already has Next.js, Firebase Auth, Firestore, transactional fulfillment code, and tests. The fastest route is Vercel plus the existing Firebase backend, with dedicated pickup devices and roles. Supabase is also a good fit for an independently hosted pickup service; choose it if relational event/attendance reporting and independent ownership justify introducing another database. Moving to Supabase is a separate data migration, not a requirement for getting stable URLs or persistent access. Do not split the same household's authoritative check-in state across Firebase and Supabase.

## What changes for staff

- One fixed production address, e.g. `pickup.<church-domain>` (illustrative, not provisioned). `/check-in` for iPads, `/packing` for the station, `/admin` for coordinators.
- Invite coordinators through the app; they sign in with individual accounts. App roles grant coordinator access, independent of Google Sheet sharing or ownership. Device access has no admin privilege.
- A coordinator enrolls each iPad once with a short-lived pairing PIN. The server rate-limits pairing attempts, stores only credential hashes, and can revoke each device independently.
- Use a first-party Secure, HttpOnly, SameSite cookie for a device credential with a rolling 90–180 day lifetime; validate expiry/revocation server-side on every request. Enrollment credentials never appear in URLs. Add CSRF/origin checks to authenticated mutations. A deployment must not invalidate enrolled devices. Clearing browser data still requires pairing again.
- Bookmark only the production domain, never a deployment preview URL. GitHub pushes produce tested deployments and update the same production domain. No code copying, two-deployment updates, or Google authorization for volunteers.

Vercel still deploys code: deployment becomes automated and the production address stays fixed. Preview deployments remain isolated, with separate secrets/data/printer destinations; they must not print real jobs.

## Data and status model

Keep these independent:

1. Attendance: expected, arrived, or absent after explicit event closure. Store arrivedAt, arrivedDeviceId and immutable attendance events. A print failure never reverses attendance.
2. Prior history: previousNoShow boolean plus its source/reason/event when known. It never means absent today. A successful check-in may therefore display Arrived / Previous No-Show.
3. Fulfillment: registered or pre-packed, with reason walk-up or previous-no-show.
4. Print job: prepared, sending, submitted, unknown, failed, manually confirmed. Provider done is OS queue delivery, not physical output.
5. Needs attention: a derived view of unresolved source/print issues, separate from attendance.

At event close, offer a coordinator-reviewed list of expected households to mark absent for that event; never infer attendance from a label being printed. Reopening/correcting an event retains an audit record. Historical missing attendance is unknown, not automatically no-show. A future event can use verified previous absences for history flags without matching households solely by name.

Preserve existing source identity: workbook + numeric tab ID + stable ID#, including duplicate-ID holds and explicit review. Stable internal registration UUIDs retain old pilot IDs as migration keys. Do not use mutable row positions as identity.

## Backend design

Tables/collections: pickup_events, registrations, attendance_events, devices, pairing_challenges, coordinator_roles, print_jobs, source_mappings, sheet_export_jobs. Keep registration snapshots and version numbers for print actions.

Server API owns imports, pairing, session checks, arrival transactions, PrintNode calls and Google Sheets credentials. Database transactions save arrival and a durable print job together. A durable worker dispatches committed print jobs, using stable idempotency keys. It must recover from crashes without automatically replaying an uncertain send. Do not rely on an unawaited serverless request continuing after an HTTP response. Use a supported queue/worker or bounded scheduled dispatch with transactional claims and leases.

The iPad receives confirmation when arrival is durably saved. Print progress and errors appear separately. A unique constraint/transaction guard on event-registration-arrival prevents duplicate jobs from simultaneous check-ins. Explicit reprints need a reason. Preserve the 120-second PrintNode expiry behavior and physical reconciliation for unknown sends.

If Supabase is selected, apply RLS to all exposed tables and keep privileged keys in server environment variables only. For custom device-cookie sessions, route device operations through a server that validates the device and scopes every query; a cookie is not automatically a Supabase Auth identity. No generic anonymous SELECT policy. Coordinator roles must come from server-controlled data, not editable user metadata. Verify denied requests, cross-event access, revocation, and concurrent arrivals against the actual database.

## Google integration

A maintained server credential reads the configured response workbook and writes a dedicated FRFS Attendance tab in that same workbook. Share the workbook with that integration identity; staff do not need direct sheet access. Restrict application writes to the app-owned destination and validate headers before writing. Google file-level Editor permission is broader than a column-level grant; application code enforces the narrower destination.

Use queued, retryable upserts keyed by registration and event. Sheets is a reporting mirror; the database is authoritative. Export status and last successful export time must be visible. A Google outage must not block check-in or printing. Include registered households, walk-ups, event date/ID, attendance, arrival time, previous-no-show flag, pre-packed reason and optional car details. Preserve leading-zero IDs and treat formula-like user text as plain text.

For phase-one compatibility, the current Apps Script build 2026-11-20.3 adds a manual export and a five-minute coordinator-owned trigger to FRFS Attendance. It does not change response columns or automatically close events. No source export is enabled until a coordinator activates it after deployment.

## Delivery sequence and acceptance gates

1. Port the existing tested pickup UI/domain logic to a normal frontend/backend boundary. Preserve small-label rendering, line/number entry, walk-ups, duplicate review, Previous No-Show filter, and explicit print recovery. Start with fictional data and a nonproduction printer.
2. Implement persistent device cookies, coordinator invitations/roles and revocation. Verify iPad Safari close/reopen, saved shortcut, network interruptions, seven-day-plus persistence rehearsal, and code deployment without re-enrollment. Browser storage deletion remains an intentional re-pair case.
3. Port source import and attendance export, with explicit event selection, duplicate review and visible sync errors. Test sorting, removed rows, missing Date heading, concurrent source edits and export failures.
4. Add transactional arrival/job creation and durable dispatch. Test two iPads, crash points, provider timeout, offline Mac, paper-out, and recovery without duplicate prints.
5. Import pilot registrations, arrivals, device audit records and print history into staging. Preserve checked-in times, source keys, existing PrintNode IDs and job outcomes. Compare counts by event and status. Do not dispatch imported jobs merely because they exist.
6. Conduct the mobile rehearsal with the existing Mac/ZD421/PrintNode path. Check production domain, network reach, login persistence, label fit and final attendance report.
7. Cut over between pickup sessions: freeze old writers/dispatchers, take a final snapshot and attendance export, migrate once with idempotent keys, verify counts, then enable the new writer. Keep the old deployment read-only. Device tokens need a controlled one-time pairing migration; Apps Script localStorage cannot be assumed available to a different domain.
8. Automate deployment from a release branch with tests, staging and rollback. A rollback must preserve accepted arrivals/jobs and prevent old/new dispatchers from both sending labels.

No subscription/pricing assumptions are part of this proposal; verify current hosting, database, queue, email and PrintNode requirements when selecting the deployment.

## Sources

- Google Apps Script iframe restrictions: https://developers.google.com/apps-script/guides/html/restrictions
- Vercel deployment URLs and production alias: https://vercel.com/docs/deployments/generated-urls
- Supabase session model: https://supabase.com/docs/guides/auth/sessions
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

The exact one-hour reauthentication cause remains unverified. The existing pilot defaults to a 180-day device token, not an hour-long session; transient startup errors previously led to the same setup screen as missing credentials. Storage loss, another browser/link, expired/revoked credentials and request failures must be distinguished during the iPad rehearsal.
