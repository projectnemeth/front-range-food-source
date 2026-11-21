# Hosted pickup pilot: Vercel + existing Firebase

Build: `hosted-2026-11-20.1`. Implemented locally; not deployed. It uses the existing Next.js/Firebase application, its existing Firebase Auth accounts, and isolated `pickup*` Firestore collections. Source responses stay in Google Sheets; the app owns the FRFS Attendance reporting tab.

## Staff and coordinator addresses

- `/pickup`: normal top-level staff webpage; no Apps Script iframe. Pair a church iPad using a coordinator-generated, single-use six-digit PIN (ten minutes). No volunteer account or Google authorization.
- `/pickup/manage`: sign in using an existing Firebase account. Existing application ADMIN users are pickup owners. Owners can grant pickup coordinator access to another existing, enabled Firebase account by email. The account must already exist; this release does not send invitations or create Firebase accounts. Share this fixed address with coordinators. Existing account password recovery remains at `/forgot-password`.
- `/pickup?coordinator=1`: same check-in interface with setup, source import, devices, duplicate review, and attendance controls. Authorization is verified server-side on every operation; changing a URL/query flag cannot grant permission.

A paired device receives an opaque Secure/HttpOnly/SameSite=Strict cookie in production, valid for 180 days and renewed with use. Only a hash is stored in Firestore. The credential is never returned in JSON or placed in localStorage or URLs. Device authorization is checked on every request; revocation prevents future access but cannot cancel jobs already submitted. Close/reopen the same browser/installed shortcut on the same production hostname. Cookie deletion, another browser, expiry and a new hostname require pairing again. Coordinator sessions are separately scoped, five-day Firebase session cookies with role checks; do not leave coordinator access signed in on shared staff devices.

## Configuration and deployment

1. Use the existing Firebase project and existing Vercel project for this repository. Choose one stable production hostname. Do not create a new production domain for every release or use preview-deployment links on iPads. Enable the pilot in staging first.
2. Configure server credentials using the existing `FIREBASE_SERVICE_ACCOUNT_KEY` (or the repository's supported Firebase server credential method). Existing `NEXT_PUBLIC_FIREBASE_*` client settings are still required for coordinator sign-in. Never set emulator variables in production.
3. Enable the Google Sheets API in the integration account's Google Cloud project. Share the original response workbook as Editor with that service account's `client_email`. Optionally use a separate `PICKUP_GOOGLE_SERVICE_ACCOUNT_KEY`; otherwise Sheets uses the Firebase service-account JSON. Workload credentials without a private-key JSON are not supported by the Sheets JWT helper in this release.
4. Set server-only `PICKUP_SOURCE_SPREADSHEET_ID`, `PICKUP_PRINTER_CONFIG` (JSON with the real PrintNode ID, DPI and widthIn/heightIn), `PRINTNODE_API_KEY`, and a strong random `CRON_SECRET`. These must never be NEXT_PUBLIC variables. The `.env.example` values are placeholders. Keep production values in Vercel environment variables.
5. Set `PICKUP_HOSTED_ENABLED=true` for the intended deployment. Keep it false in previews unless the preview uses isolated test data and a test printer. Enabling the flag against a production Firebase project grants access to production pickup collections; it is not a sandbox.
6. Deploy the Next.js application to Vercel through the existing GitHub workflow. The Next config includes the reusable HTML UI in `/pickup`'s function bundle. Normal releases update the production alias; no Apps Script code copying or two-deployment steps. Firebase rules retain default-deny for pickup collections; all access goes through server endpoints. No new client rules or composite indexes are required by this release.
7. Sign in at `/pickup/manage` as an existing application ADMIN. Open coordinator tools, Check setup, select/enable the correct numeric source tab, preview counts, then Refresh source data. Resolve duplicate-ID groups. Do not choose FRFS Attendance as a source event.
8. Create a pairing PIN for each named iPad, open `/pickup` on that iPad and enter it. The server consumes each PIN once and rate-limits guessing. Verify close/reopen and cookie persistence on real iPads; emulator tests do not establish Safari's behavior over weeks.
9. Open Attendance history controls. Sync now verifies permissions and writes a first report. Enable scheduled sync marks it enabled in Firestore; the worker schedule below is also required. Keep one writer of FRFS Attendance during cutover. Do not let old Apps Script and new hosted exports overwrite one another.
10. Perform a one-household fictional physical print test through the existing awake Mac/PrintNode/ZD421 before real pickup. Submitted/done does not prove physical output.

## Background worker and attendance export

`GET /api/pickup/worker` requires `Authorization: Bearer <CRON_SECRET>`. It dispatches at most five never-dispatched Prepared jobs and, when enabled/dirty, exports attendance. It awaits its work; no unawaited background promises or ephemeral in-memory queue. The immediate check-in request normally dispatches its own saved job. Prepared jobs left by a crash can be resumed by the worker within their two-minute dispatch window. Older unsent requests fail visibly and require an explicit reprint, so a delayed scheduler cannot send stale packing labels. Sending/unknown jobs are never automatically replayed.

Configure an authenticated scheduler to call this endpoint every five minutes. Vercel Cron automatically supplies CRON_SECRET when configured; confirm that the project's plan supports the desired frequency and function duration. A Vercel config example (merge into an existing config if present) is:

```json
{
  "crons": [
    { "path": "/api/pickup/worker", "schedule": "*/5 * * * *" }
  ]
}
```

This example has not been activated automatically. Google Cloud Scheduler or another authenticated scheduler is an alternative. Vercel deployment-protection settings must allow the scheduler to reach the function; application cookie access is still enforced on staff endpoints. Set up monitoring for failed runs and verify the latest export timestamp in Check setup. Function maxDuration is 300 seconds in code; actual limits depend on the deployment. If no scheduler is configured, manual sync works but automatic attendance export and unattended Prepared-job recovery do not run. Schedule cadence is also the upper bound on crash recovery latency.

Attendance is a retryable mirror, not the authoritative record. Firestore saves a generation counter with check-ins, source imports, duplicate decisions and car corrections; an export only clears dirty when no newer generation appeared. A Google outage leaves dirty/error visible for retry and does not roll back arrivals or resend labels. Export creates/updates only FRFS Attendance using RAW cell values and preserves prior exported event rows. The response tabs and form answer columns stay intact. Existing destination headers must match the pilot's 17-column attendance layout; incompatible headers or duplicate IDs fail visibly.

The report includes event ID/name, source ID/tab, name/phone/household size, Expected/Arrived, UTC arrival time, previous-no-show flag, pre-packed reason, car details and source-review flag. Expected after pickup means no recorded arrival; automatic event closure/absence finalization is not implemented. Do not interpret a failed label as a no-show. Reports do not reconstruct attendance that was never recorded.

## Current limits and cutover requirements

- Import explicitly enabled pickup tabs with the verified five-field mapping and known blank Date-header fallback. Source grid limit: 2,500 rows/100 columns per tab; 1,500 households across enabled events. Lists cap 1,500 households and 3,000 jobs per event; export caps 10,000 retained records. Imports are idempotent per registration; a timeout can leave a partial import and must be retried/reviewed before opening pickup. Do not run an import during a live pickup if its source is being reorganized.
- One configured PrintNode printer, label dimensions and DPI per deployment. The ported renderer is verified against the pilot's output, including small stock, accents, car line and pre-packed bar. No automatic printer failover.
- All paired iPads can read/check in enabled pickup events. No event-specific device assignment in this release. Coordinator operations require a coordinator session; devices cannot import, export, grant roles or issue PINs.
- Coordinator grants can be revoked in Firestore `pickupCoordinators/{uid}.active=false` immediately; application ADMIN roles still confer owner access. Device revocation is in the app. The UI supports granting existing accounts; a full coordinator invitation/revocation list is follow-up work.
- Setup can enable tabs. Retire an old event by setting `pickupEvents/{hash(eventId)}.enabled=false` through an authorized server/console procedure; self-service closure is follow-up work. Historical attendance exports remain.
- No automatic source-import schedule in this release. Refresh source data before pickup and after relevant edits. Attendance scheduling does not import new registrations.
- No automatic migration of the pilot's working workbook is included. **Do not switch a live event to this app without migrating existing arrival/print history or starting a genuinely new event.** Importing response rows alone does not bring over Apps Script arrivals. Before cutover, freeze old check-in/print/export writers, capture the working workbook and existing provider IDs, migrate/reconcile them under a reviewed procedure, compare event/status counts, then enable the new writer. Never replay historical print jobs. iPads need one new pairing on the new hostname.
- Archival, restore drills, live multi-week Safari verification, and a real production Google/PrintNode rehearsal remain deployment gates. Local tests mock those external services; no real registrations have been imported by development tests.

## Validation commands

- `npm run test:pickup`: parser, historical flags, label parity and hosted transport.
- `npm run test:pickup:emulator`: actual Firestore transactions/security boundaries with mocked Google/PrintNode. Requires local Java 21+ and Firebase emulators; never uses a production project.
- `npm run test:pickup:browser`: targeted hosted UI tests with mocked APIs; the test helper supplies nonproduction Firebase values.
- `npm run typecheck`, `npm run build:test`, and existing application tests before release.

## Verified local results

The first implementation passes the existing 47 unit tests (including four hosted domain/transport tests), 16 dedicated Firebase emulator tests, two iPad-sized hosted browser tests, TypeScript checking and a Next.js production build. Google Sheets and PrintNode were mocked in integration tests; the Firestore transactions and access boundaries used the local Firebase emulator. The browser test exercised six-digit pairing, an HttpOnly cookie, reload persistence, arrival and the Previous No-Show filter. These checks do not prove physical output, real account permissions or months of Safari persistence. No live deployment or source-workbook mutation was performed.

## Login recovery — hosted-2026-11-21.1

A deployed session endpoint and profile endpoint were observed returning HTTP 500 with zero-byte bodies. Firebase Admin previously initialized while route modules were imported; invalid deployment credentials could bypass the route's error handler and produce that empty response. The coordinator page then attempted JSON parsing without checking the response, obscuring the actual failure.

The server now initializes Firebase lazily, validates the server JSON/project match, normalizes escaped private-key newlines, and returns a structured 503 setup message for configuration failures. No private-key content is returned. `/api/pickup/health` reports the deployed build and configuration-only readiness without exposing credentials, account roles or household data. It does not verify Firestore IAM permissions or the existence/role of a specific user.

The pickup coordinator page bypasses the food-order profile provider and confirms its server session after signing in. It needs either the existing ADMIN role or an active pickup coordinator grant; a food-ordering household profile is not required. Empty/non-JSON responses show the HTTP status and recovery instructions instead of a JSON parser exception. Authorization requirements have not been relaxed.

After this build deploys, open `/api/pickup/health`. If it returns a setup error, follow that message in Vercel → Settings → Environment Variables → Production, save, and redeploy. FIREBASE_SERVICE_ACCOUNT_KEY must be the whole JSON object, not a path, snippet, or JSON string wrapped in extra quotes. Its project_id must match NEXT_PUBLIC_FIREBASE_PROJECT_ID. Private keys should only be supplied in the protected Vercel setting. Then sign in at `/pickup/manage` (the general `/login` route is still for the ordering application).

Verification: 51 unit tests, 17 hosted Firebase emulator tests, 61 existing Firebase regression tests, four hosted browser tests, TypeScript checking, and a clean production build pass. New coverage includes malformed server settings without import crashes, safe empty-response handling, role-only admin and pickup-grant login/session cookies, and a coordinator login that makes no food-profile request. Real account login still requires correct deployment credentials and existing server-side roles.
