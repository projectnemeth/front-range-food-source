# Remediation implementation status

Updated November 4, 2026. Local implementation complete against review baseline `2df2e86`; production cutover and staging verification remain outstanding. This report records verification before publication. Production deployment and data migration are tracked separately.

## Implemented

| Spec | Result |
| --- | --- |
| R1 | Authenticated, create-only profile finalization; validated fields; normalized transactional uniqueness reservations; collision-resistant food bank IDs with retry; authenticated rate limiting; public duplicate lookup retired |
| R2 | Server-owned identity, pickup date, item grouping, timestamps and statuses; ordering-window checks; atomic per-user/per-batch reservation; idempotent retries; fallback protection for legacy orders; required consent |
| R3 | Signed-in incomplete-profile recovery; profile reload after completion; distinct missing-profile and server-error paths; stale auth-response protection |
| R4 | Authorized atomic batch transitions; explicit new pickup creation; reopen preserves batch; future activation resolved on server requests; schedule validation and retry protection |
| R5 | Shared catalog and types; admin fulfillment details; dietary counts, baby supplies, household counts and notes available to packers; legacy-field fallbacks |
| R6 | Calendar-date formatting independent of browser timezone; Denver schedules stored as UTC instants; invalid or ambiguous DST times rejected unless a valid explicit offset resolves ambiguity |
| R7 | Both print routes use the same renderer; selected and loaded-order scopes; measured Letter pagination; repeated identity and dietary headers; even-sheet boundaries for duplex printing |
| R8 | Versioned proposed Firestore rules and indexes; denied direct profile/order creation and reservation writes; privileged packing edits; environment example; modular Firebase Admin initialization |
| R9 | Synchronized lockfile and runtime versions; updated runtime libraries; lint/type repairs; saved Russian restoration; bounded paginated order loading and count queries; CI and regression tests |

An availability refresh that detects a new pickup also clears pickup confirmation and disclaimer acceptance. Families must confirm the new date before submitting. Scheduled activation is request-driven, not a background timer: the first availability or submission request after the opening resolves the new active batch transactionally.

## Local verification

- Clean `npm ci` completed with the final lockfile.
- ESLint: zero errors and warnings using `--max-warnings=0`.
- TypeScript check passed.
- Seven unit tests passed: calendar dates, DST, availability boundaries, schemas, item grouping, localization parity and packing-label completeness.
- Eleven Firebase Emulator integration tests passed: permissions, profile preservation and duplicate reservations, ten concurrent order submissions, retries, closed/stale/incomplete-profile rejection, legacy orders, scheduled activation, authenticated endpoint protection, batch reopen/idempotency and migration reconciliation.
- Three Playwright browser tests passed: interrupted registration recovery, Russian persistence, and both print routes with complete item lists, long notes and multiple families.
- Optimized production build passed using isolated nonsecret test configuration. A deployment must build separately with real project client configuration.
- Production-only dependency audit reports zero vulnerabilities. The full audit still includes transitive development-tool advisories; those are not part of the production-only result.
- Print QA covered correct Mountain Time pickup dates, all requested fulfillment fields, no page overflow, repeated family headers, Letter page dimensions and odd-page family starts. Physical printer settings still require a staging/operator check.
- `git diff --check` passed.

## Production work still required

Follow [deployment and verification](deployment.md). No production resources were read or changed during implementation.

1. Compare deployed Firestore rules and indexes with the proposed files, including any other application using the database.
2. Back up existing data, pause old writers, run the migration dry run and review conflicts. Supply approved schedule mappings and explicit duplicate dispositions before applying the idempotent backfill.
3. Verify real server credentials and hosting environment. Deploy indexes, reviewed rules, server handlers and clients in the documented cutover sequence. Stale browser clients must refresh.
4. Exercise the flows in staging and verify physical Letter/duplex output before reopening production ordering.

Existing date/time intent and duplicate-order dispositions cannot be inferred safely from the repository. The migration deliberately requires explicit mappings or choices and preserves original profiles and orders. Credentials, reports and disposition files belong outside Git.
