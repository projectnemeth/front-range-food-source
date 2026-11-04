# Front Range Food Source Remediation Specification

Status: Draft for implementation  
Date: November 3, 2026  
Repository: https://github.com/projectnemeth/front-range-food-source  
Review baseline: `2df2e86`

## Purpose and scope

Protect user profiles, enforce food request rules on the server, and make the information collected from families available to volunteers. Repair registration recovery, pickup dates, batch transitions, printing, and the checks required to ship these fixes.

Use targeted changes within the existing Next.js and Firebase application. Preserve existing accounts, orders, roles, and historical batch membership. This work does not include a visual redesign or migration to another backend.

The review found implementation defects in the repository. Deployed Firestore rules and indexes require inspection before release; their current behavior is not established by the source code. The requirements below define the intended behavior and must be verified in a staging environment.

## Priority and delivery order

| Phase | Deliverables | Completion gate |
| --- | --- | --- |
| 1 | Reproducible dependencies and checks; authenticated profile creation; deployed permission review | Anonymous profile writes and unauthorized database access are blocked |
| 2 | Server order validation and uniqueness; batch transitions; registration recovery | Concurrent and retried requests preserve application invariants |
| 3 | Complete packing information; date handling; unified printing | Volunteers can fulfill requests from correct, readable sheets |
| 4 | Remaining authentication state, localization, dashboard, and lint repairs; staging verification | All required checks and regression scenarios pass |

Protect the profile endpoint first if fixes are released incrementally. Do not wait for printing or cosmetic cleanup to address it.

## Required application invariants

- Profile creation uses the authenticated UID and cannot replace an existing profile or assign an administrator role.
- A family has at most one order per batch. Concurrent submissions and retries cannot create extra orders.
- Orders are accepted only for the active, open ordering batch, evaluated using server time.
- Names, email, batch assignment, pickup date, creation time, and initial fulfillment status are derived or validated by the server.
- All dietary and baby supply information collected from a family is available in the admin view and relevant packing sheets.
- Pickup dates remain calendar dates. Ordering timestamps identify an unambiguous instant in the `America/Denver` business timezone.
- Closing and reopening an existing batch preserves its orders and uniqueness boundary.

## R1 Authenticate and validate profile creation

Primary files: `src/app/api/finalize-registration/route.ts`, `src/app/register/page.tsx`, `src/app/api/validate-registration/route.ts`.

### Requirements

1. Require a valid Firebase ID token on profile finalization. The client must send it after creating or signing in to the account.
2. Obtain UID and email from the verified identity. Reject attempts to supply conflicting identity values. Do not trust a body-supplied UID as the document path.
3. Create a profile only when it does not exist. Use a transaction or create precondition rather than an unconditional `set`. Replays must return a safe existing-profile result without replacing any fields, including role or `createdAt`.
4. Accept only explicitly defined profile fields. Validate required text, email availability in the authenticated identity, county, contact fields, and nonnegative integer household counts. Require at least one household member and calculate the total on the server. Apply documented length limits.
5. Assign `USER` on initial creation. Role changes must use a separate privileged process. Reject role, creation timestamp, and other server-owned fields supplied in a creation request.
6. Perform authoritative duplicate checks during finalization. The preliminary validation endpoint is advisory and cannot be the only enforcement point.
7. Normalize phone and address inputs consistently before duplicate checks. Document normalization and preserve original display values where needed. Use transactional reservation records for fields required to be unique; independent queries followed by a write do not guarantee uniqueness.
8. Retain the current phone, address, supplied food bank ID, and exact-name duplicate policy initially. Document that policy and obtain a product decision before relaxing it, particularly for unrelated households with matching names or shared addresses. Generated food bank IDs must use collision-resistant generation and the same uniqueness enforcement as supplied IDs.
9. Keep validation responses free of other families' personal data. Limit abuse of the public duplicate-check endpoint and profile finalization using a deployment-compatible rate limit. Do not log names, addresses, tokens, or request bodies.

### Acceptance criteria

- Missing, expired, or invalid tokens return `401` and perform no write.
- User A cannot create or replace user B's profile.
- Replaying creation cannot reset an administrator to `USER` or change an existing profile.
- Invalid fields return `400` with actionable field errors and no partial profile.
- Two concurrent registrations claiming the same unique value cannot both succeed.
- A generated food bank ID collision is retried safely without overwriting another reservation.

## R2 Make order submission authoritative and atomic

Primary files: `src/app/api/orders/submit/route.ts`, `src/app/api/orders/check/route.ts`, `src/app/request/page.tsx`.

### Requirements

1. Verify the ID token and require a completed user profile before accepting an order.
2. Read the active batch and current settings on the server. Apply manual open or closed overrides first; otherwise accept only within a valid schedule. Use the interval `openAt <= now < closeAt`.
3. Treat a submitted batch ID as an expected version. Reject a stale, missing, or inactive batch with `409` and prompt the client to refresh. Never silently transfer a request to another pickup.
4. Copy the batch's pickup date and verified profile identity into the order. Reject contradictory client values. If an active batch lacks a valid pickup date, reject submissions and show an actionable admin configuration error.
5. Enforce one order per UID per batch with a transaction and a stable uniqueness record. Preserve existing order document IDs: use a unique reservation such as `orderReservations/{batchId}/users/{uid}` pointing to the order. Backfill these records for existing orders before enabling the new write path.
6. Read the relevant settings and batch documents inside the transaction, so a concurrent closure or batch switch forces validation to retry. Create the order and reservation in the same transaction.
7. Use an allowlist schema for item keys, integer dietary counts, baby supply selections and details, confirmations, and notes. Bound strings and arrays. Calculate dry and fresh item groups from one shared catalog on the server. Never spread arbitrary request fields into Firestore.
8. Require pickup confirmation and disclaimer acceptance. Include acceptance in the persisted order with the applicable disclaimer version and server timestamp.
9. Persist initial order and packing status on the server. A replay for the same batch and UID must return the existing order reference without changing its contents or status.
10. Keep the check endpoint as a UI aid. Disable submission while its result is pending; show an error and retry option if it fails. The submit endpoint remains responsible for correctness.
11. Return documented errors: `400` invalid input, `401` invalid identity, `403` incomplete profile, `409` stale batch or closed ordering, and `500` unexpected failure. A duplicate replay returns a successful existing-order response with an explicit replay indicator.

### Acceptance criteria

- Ten simultaneous submissions by one user for one batch create exactly one order and one reservation.
- A timeout followed by a retry returns the same order ID.
- Closed, future, expired, stale-batch, and profile-less submissions create no order.
- A closure committed before the order transaction completes prevents acceptance.
- Unknown item keys, negative counts, arbitrary status fields, spoofed identity, and mismatched pickup dates are rejected.
- Orders already present before deployment block new orders for the same user and batch.
- A new, explicitly activated batch permits one new order for a family that ordered previously.

## R3 Recover interrupted registration

Primary files: `src/app/register/page.tsx`, `src/context/AuthContext.tsx`, home and request route guards.

### Requirements

- Model authentication and profile completion separately: signed out, loading identity, loading profile, incomplete profile, ready, and recoverable profile error.
- If account creation succeeds but profile completion fails, retain the signed-in account and allow profile completion to retry. Do not require another account creation or treat password reset as profile recovery.
- On later login, a missing profile must lead to the completion flow. A server or network failure must show retry UI rather than being mistaken for a missing profile.
- Refresh auth context after finalization succeeds. Initial sign-in can trigger a profile fetch before finalization; that earlier response must not overwrite the newly completed profile.
- Clear previous profile state when identity changes. Ignore stale asynchronous responses after sign-out, account switching, or unmount. Set loading state for each identity transition.
- Block food requests until the profile is complete, both in the UI and server submission handler.

### Acceptance criteria

- Simulated failure after Firebase account creation can be recovered in the same session and after signing out and back in.
- Successful completion updates the context immediately without requiring a reload.
- A delayed response for user A never populates user B's profile or restores a profile after sign-out.
- A `404` profile response and a `500` response produce distinct recovery paths.

## R4 Define batch creation and activation

Primary files: `src/lib/batchUtils.ts`, `src/app/admin/settings/page.tsx`, `src/app/api/settings/route.ts`.

### Requirements

- Separate “create next pickup batch,” “activate batch,” “close ordering,” and “reopen current batch.” Reopening must not create a new batch. Repeating an action must be idempotent.
- Store the pickup date and opening and closing timestamps on the batch. Define lifecycle states such as `DRAFT`, `SCHEDULED`, `OPEN`, and `CLOSED`.
- Saving a future batch must not immediately replace an active batch. Use an authorized scheduled activation process or a server resolver that transactionally activates an eligible scheduled batch. Document the chosen mechanism and verify it works without an administrator keeping a page open.
- Reject overlapping scheduled ordering windows in the initial implementation. Maintain one authoritative active batch and explicit activation rules.
- Make batch activation, previous-batch closure, and global active-batch updates atomic. A partial write must never expose settings for one batch with another batch's pickup date.
- Require administrator authorization for transitions. Disable duplicate UI actions while saving, and restore the confirmed state if an action fails.
- Validate opening before closing, a valid pickup date, and consistent scheduling fields before saving. Manual open may override the schedule but must still require a valid active batch and pickup date.
- Refresh request availability on relevant settings changes and schedule boundaries. An already-open browser must reflect closure; the server remains the final authority.

### Acceptance criteria

- Close and reopen preserve batch ID, historical orders, and per-family order limits.
- Clicking “open” twice creates no additional batch.
- A future schedule does not move today's orders into the next batch.
- Concurrent administrator actions leave one valid active batch.
- Activation occurs at the intended time without an admin browser session.
- A failed transition leaves the previous database state intact and a truthful UI.

## R5 Carry all fulfillment information into admin and print views

Primary files: `src/app/admin/page.tsx`, `src/app/admin/PrintLayout.tsx`, `src/app/request/page.tsx`.

### Requirements

- Introduce shared, explicit types for profiles, orders, baby requests, dietary restrictions, and item categories. Extract the duplicated item catalog into a shared module.
- Display dietary restrictions and gluten-free/vegan counts prominently in the admin details and on each relevant packing sheet. Surface restrictions even when no special prepared-meal checkbox was selected.
- Display diaper size, formula type, requested baby supplies, and baby notes on the dry goods or household packing sheet. Volunteers must not need Firestore access to discover these requests.
- Retain both dry and fresh item lists, family identification, phone, pickup date, and notes. Include household counts where needed for packing; obtain these through an authorized profile lookup and define a clear missing-value display.
- Older orders without newer fields must render safely. Show “Not recorded” for absent dietary and baby information rather than implying “None.” Preserve legacy `items` as a fallback for `otherItems`.
- Do not infer that a dietary restriction has been fulfilled from packing completion alone. Keep recorded requests visible until pickup completion.

### Acceptance criteria

- A sample order with gluten-free and vegan counts, diapers, formula, baby notes, and both item groups shows every supplied value in the admin details and applicable printed output.
- Orders with no fresh items, old orders, missing phone numbers, and long names or notes remain usable.
- Shared item keys and category assignments are consistent across form, server validation, dashboard, and printing.

## R6 Correct date and timezone handling

Primary files: request date formatting, packing date formatting, admin scheduling inputs, and server availability logic.

### Requirements

- Store pickup dates as validated `YYYY-MM-DD` calendar dates. Format their year, month, and day without UTC-to-local conversion; do not use `new Date(dateOnly).toLocaleDateString()`.
- Treat ordering schedules as `America/Denver` business times regardless of the administrator's browser timezone. Convert explicitly to UTC instants for storage and comparison. Label the business timezone in the admin UI.
- Reject nonexistent daylight-saving local times. For ambiguous times, require an explicit offset or choice before saving.
- Use shared formatting and conversion utilities. Localize the displayed date for supported languages while preserving the same calendar day.

### Acceptance criteria

- Pickup `2026-11-07` displays November 7 in Denver, Los Angeles, and UTC browser environments, including print output.
- Admins in different timezones saving the same Denver schedule produce the same instants.
- Opening and closing boundary tests pass on standard time, daylight time, and DST transition days.
- Invalid dates and reversed or incomplete schedules cannot be saved.

## R7 Repair and unify printing

Primary files: `src/app/admin/print/page.tsx`, `src/app/admin/PrintLayout.tsx`, `src/app/globals.css`.

### Requirements

- Use one packing renderer for dashboard printing and the standalone print route. Align the print root with global CSS so content is visible on paper and navigation is hidden.
- Support explicit batch selection on the standalone route; default to the current batch rather than all historical orders. Preserve selected-order printing from the dashboard and label the print scope.
- Render checklist selections and the fulfillment fields in R5 instead of only the legacy free-text field.
- Trigger printing only once the intended orders and required profile details are rendered. Show read failures and prevent printing incomplete results as if they were complete.
- Validate US Letter output. Keep order identification on continuation pages. Preserve the intended duplex separation between families even when long content spans more than the expected pages; do not rely solely on fixed spacer heights.

### Acceptance criteria

- Both entry points produce visible packing sheets containing the same order information.
- Printing selected orders excludes unselected and historical orders.
- Print previews for short and overflowing orders are readable, contain all requested items and notes, and keep family boundaries clear during duplex printing.

## R8 Verify database authorization and deployment configuration

Primary areas: Firebase rules, indexes, administrative client reads and writes, and environment setup.

### Requirements

- Retrieve and review the deployed Firestore rules and required indexes through an authorized project connection. Add reviewed rules and index definitions to version control without credentials.
- Deny anonymous access to private profiles, orders, and administrative collections. A user may read only their own permitted data; users cannot edit roles or bypass the server submission and registration invariants through direct Firestore writes.
- Protect administrator operations with a trusted administrator role source that ordinary users cannot modify. Client route redirects are navigation behavior, not authorization.
- Test retained direct admin Firestore operations against rules. Move an operation to an authenticated server handler if its invariants cannot be safely expressed in rules.
- Verify indexes required for user/batch order checks, batch-filtered order lists sorted by creation date, and user statistics. Do not swallow missing-index or permission errors as empty data.
- Add an `.env.example` containing variable names and setup instructions only. Keep service credentials out of the repository. Fail clearly when server credentials are malformed or missing; do not continue as if initialization succeeded.

### Acceptance criteria

- Emulator tests cover anonymous, ordinary-user, and administrator reads and writes for every relevant collection, including reservations.
- A normal user cannot grant themselves admin access or read another family's personal data.
- Admin settings, batch transitions, packing updates, and lists work under the reviewed rules and indexes in staging.
- The deployed rules and indexes match the committed definitions after release.

## R9 Restore reproducible checks and remaining state behavior

Primary areas: `package.json`, `package-lock.json`, ESLint, authentication/language contexts, and admin data loading.

### Requirements

- Select and document supported Node and npm versions. Regenerate and commit a synchronized lockfile using those versions; the reviewed `npm ci` failed because `@opentelemetry/api` was absent from the lockfile.
- Resolve the 11 lint errors and 23 warnings observed during review without broadly disabling rules. Replace untyped payloads, unsafe suppressions, unused imports, and problematic effect organization with explicit types and appropriate data loading.
- Fix the admin no-batch initialization path: it must complete its data fetch after discovering there are no batches rather than relying on an unchanged empty selected batch ID to retrigger an effect.
- Ignore stale batch-fetch responses when users switch batches quickly. Show failures separately from a valid empty result and provide retry controls. Apply bounded date filters and pagination rather than fetching all historical orders and users repeatedly for routine statistics.
- Restore all supported saved languages, including Russian, after reload. Translate recovery, validation, and submission errors introduced by these fixes.
- Add CI for a clean install, lint, TypeScript, tests, and production build using safe test configuration. Supply build-time Firebase configuration through CI variables where required; never use production service credentials for test jobs.

### Acceptance criteria

- Fresh checkout: `npm ci`, `npm run lint`, TypeScript checking, required tests, and production build all pass on the documented runtime.
- An admin with no batches receives a completed, truthful empty or legacy-order view.
- Rapid batch switching cannot display a previous batch's orders under the current selection.
- Saved English, Spanish, and Russian selections survive reload.
- No production write or real-family data is required to run automated tests.

## Test strategy and release gates

Use unit tests for schemas, item grouping, date conversion, and availability decisions. Use Firebase Emulator integration tests for authorization, profile reservations, order uniqueness, and transactions. Use browser tests for interrupted registration, stale auth responses, request recovery, and admin transitions. Inspect print previews or generated PDFs for layout; a DOM assertion alone does not establish print correctness.

The minimum regression suite must cover anonymous profile replacement, existing administrator preservation, parallel duplicate orders, retry after timeout, closure during submission, future batch activation, interrupted registration, Mountain Time dates, dietary and baby request printing, blank standalone printing, legacy orders, and denied direct database writes.

### Data preparation

1. Back up relevant collections and verify restore access before migrations.
2. Inventory existing orders by user and batch. Identify duplicates, missing batch IDs, invalid dates, and incomplete profiles. Do not silently delete or reassign them.
3. Build an idempotent dry-run migration for uniqueness reservations and batch metadata. For duplicates, report affected records and require an explicit disposition before enforcing a single canonical reservation. Preserve all original orders.
4. Reconcile existing schedules with the Denver timezone before converting timestamps; do not assume previously stored browser-local values already represent Denver time.
5. Test migrations in staging and record counts before and after. Disable ordering during the final reservation backfill and server write-path cutover so older clients cannot create unreserved orders during migration.

### Deployment and rollback

- Deploy compatible schemas and clients before enforcing newly required request fields. Coordinate final enforcement with the ordering pause; stale clients must receive a refresh message rather than corrupting data.
- Release reviewed rules, indexes, server handlers, client recovery flows, and batch activation configuration together as required by their dependencies.
- Resume ordering only after staging checks, production configuration checks, and migrated reservation counts pass. Use dedicated test accounts for any production smoke checks and exclude their orders from real fulfillment.
- Monitor structured error codes, duplicate replay counts, denied writes, batch activation failures, and incomplete profiles without logging personal data or tokens.
- If release checks fail, keep ordering closed and roll back compatible UI changes as needed. Preserve reservations and accepted orders. Never restore the unauthenticated profile overwrite endpoint or duplicate-accepting order writer as a rollback strategy.

## Definition of done

All R1–R9 acceptance criteria pass, historical data is preserved, deployment rules and indexes are versioned and verified, migrations are repeatable, packing previews are approved for readability, and the repository has passing automated checks. The completion report must identify the deployed commit, migrations performed, verification results, and any explicitly deferred requirement.
