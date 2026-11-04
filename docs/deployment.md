# Remediation deployment and verification

The remediation is implemented locally. No production Firebase resources have been modified. A Firebase project connection and hosting deployment access are required to inspect existing rules/indexes, perform the backfill, and release. Do not replace deployed rules without comparing them with `firestore.rules` and accounting for any other applications using the same database.

## Local setup

Use Node 24 and npm 12 (`.nvmrc`, `package.json`). Run `npm ci`, copy `.env.example` to `.env.local`, and supply project-specific values. Set the server-only service account JSON or use Application Default Credentials. Never expose it through a `NEXT_PUBLIC_` variable.

For isolated verification, use the `demo-food-source` project and Java 21. `scripts/test-env.mjs` supplies fake Firebase client values and emulator addresses and removes inherited service credentials. The emulator flags must never be set in production.

Commands:

- `npm run lint -- --max-warnings=0`
- `npm run typecheck`
- `npm test`
- `npm run test:emulator`
- `npm run build:test`
- `npx playwright install chromium`
- `node scripts/test-env.mjs ./node_modules/.bin/firebase emulators:exec --project demo-food-source --only auth,firestore "npm run test:browser"`

CI runs the same checks and retains print PDFs as artifacts. `build:test` produces a test-configured build; produce a separate `npm run build` with production client configuration when deploying.

## Rules and application behavior

Ordinary clients cannot create/update profiles or submit orders directly to Firestore. Authenticated server handlers validate these operations. Client administrators can read profiles, batches, and orders and update only the two packing statuses. Administrator role assignment remains a privileged Firebase Admin operation; existing administrator profiles are preserved.

The old public duplicate-validation endpoint returns `410 refreshRequired`. Finalization now authenticates and checks uniqueness atomically. Old browser clients must refresh. Reservation documents store hashed unique values and are not client-readable.

Profile uniqueness preserves the previous business policy for phone, address, food bank ID, and name. Phone punctuation and a leading US country code are normalized. Names, IDs, and addresses use trimmed, lowercase, collapsed-whitespace comparison. This is not postal address standardization; administrators must resolve equivalent addresses beyond these transformations. Identical names and shared addresses can still block unrelated households under the retained policy.

Rate limits use Firestore transactions keyed by UID and minute. Anonymous registration validation is no longer exposed. Enable TTL for `rateLimits.expiresAt` via the committed indexes configuration. These limits constrain authenticated callers; abuse involving many newly created Firebase Auth accounts also requires the project's Auth quotas/abuse controls.

## Existing data cutover

1. Export relevant collections and verify a restore procedure. Inspect deployed rules/indexes and capture their current definitions for comparison.
2. Pause ordering and registration completion for the deployment maintenance window. Set `settings/global.isFormOpen` to `false`; also suspend old application writers while backfilling. Verify the old submission endpoint cannot continue accepting orders during maintenance.
3. Run `npm run migrate` with authorized server credentials. It is a dry run by default and prints record counts, missing data, and conflict counts without names or addresses. Use `--report /secure/path/report.json` for record IDs and reservation conflicts needed for reconciliation. Store reports outside Git.
4. Resolve duplicates explicitly. The tool refuses to choose a canonical order automatically. Preserve original orders. Supply `--dispositions /secure/path/dispositions.json` mapping each conflicted reservation path to one of the candidate objects in the report, for example `{ "orderReservations/batch/users/uid": { "orderId": "chosenExistingOrderId" } }`. The tool validates that the choice names an existing candidate; it never deletes the other records. Keep the reviewed disposition file as the migration audit record. Repair incomplete profiles separately through an approved administrative process.
5. Legacy batches need pickup date and unambiguous UTC schedules. Supply an approved JSON mapping through `--batches /secure/path/batches.json`; the schema is `{ "existingBatchId": { "pickupDate": "2026-11-07", "scheduledOpen": "2026-11-03T16:00:00Z", "scheduledClose": "2026-11-05T23:00:00Z" } }`. Manual batches use empty schedule strings. Confirm that the original schedule represented Denver time before converting it. The tool does not guess timezone intent or reassign historical orders.
6. Run `ORDERING_PAUSED=true npm run migrate -- --apply --batches /secure/path/batches.json`. Include the reviewed `--dispositions` file if conflicts require it. This creates missing reservations and fills approved batch metadata. It never replaces profiles or orders. Only a supplied and validated disposition may replace a differing reservation pointer. Each write is idempotent; interrupted runs can resume. Re-run the dry run and compare counts before proceeding.
7. Deploy reviewed indexes and wait for them to become ready. Deploy server and client changes with reviewed rules. Build using real client configuration and valid server credentials. Verify all non-test emulator flags are absent.
8. In staging, exercise missing/expired token rejection, administrator preservation, duplicate-order concurrency, stale pickup rejection, registration retry, both print routes, and schedule activation. Inspect and approve Letter/duplex print previews including long notes and multiple families.
9. Use a dedicated test account for any approved production smoke check; exclude its order from fulfillment. Reopen ordering only after the active batch has a valid pickup date and the migrated reservations are verified.

Settings now use explicit new-batch creation. Closing and reopening a pickup keeps its batch ID. A future batch remains pending until its opening time; `/api/settings` and order transactions resolve and activate eligible batches atomically on demand. Activation needs no admin browser, but does not run a background job when there are no requests. This is intentional: the first availability or submit request gets authoritative current state. A previously saved pending batch cannot overlap an open manually overridden batch at creation time. Administrators must avoid reopening a current pickup past an upcoming activation; the scheduled pickup replaces it at its configured opening.

## Rollback

Keep ordering and registration completion paused if release checks fail. Preserve reservations, migrated metadata, and accepted orders. Roll back compatible client changes if needed, but never restore the unauthenticated profile overwrite route or the old unconditional order writer. Record any manual data repair before resuming.
