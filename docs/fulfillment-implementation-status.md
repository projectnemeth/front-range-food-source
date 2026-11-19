# Phase Two fulfillment implementation status

Updated November 19, 2026. Eleventh development slice: new selections during coordinator-reviewed reconciliation. Google metadata, headers, and a small selection of noncontact request cells were inspected read-only. No live import, deployment, or pilot integration occurred.

## Latest packing-quantity milestone

Approved allocations can now be linked to existing orders through a server-owned preview and atomic apply. Every household must be linked; stable bindings persist across item plans. Effective targets are shown and enforced in dry picking without modifying original manifests or perishable timing. Zero allocations remain visible and require confirmation. Stale plans, source changes, existing work and competing claims block apply. Applied item plans are locked against replacement pending reconciliation. See [workflow and limits](fulfillment-packing-allocations.md).

## Latest allocation milestone

The gated coordinator workspace now proposes whole-unit quantities proportional to household size and entered available stock. It shows zero allocations, allows reasoned adjustments, and rejects totals above stock. Approval saves an immutable reviewed plan with audit history; item-level versions reject competing stale previews. Current plans can be reopened. The planner does not reserve inventory, generate manifests, alter physical work, or enable events. See [allocation workflow, policy and limits](fulfillment-allocation-planner.md).

## Latest source-discovery milestone

The user supplied the itemized Google Form response workbook. Its real header layout and bounded request samples now ground a positional response-review adapter, with a local `fulfillment:review-source` command. It preserves whole cells (including commas within choice labels), dietary and infant details, and both earlier/later household fields. Fresh/refrigerated and frozen categories remain after-arrival. Header drift blocks extraction; ambiguous identities and unknown fields remain flagged. This produces review records, not pickable manifests. User-confirmed first/third-Saturday windows now produce candidate pickup dates from Column A, with boundary-time and exception review retained. Quantities depend on household size and current stock; exact per-item allocations, shelf rules and cross-workbook check-in linkage still require review. See [source findings and usage](fulfillment-source-mapping.md).

## Latest reconciliation milestone

Coordinators can review previous and proposed manifests and replace only unstarted orders. Transactional checks reject a stale preview if picking or other work began, and a mixed batch remains all-or-nothing. Updates preserve order identity, increment the version, retain both manifests in audit records, and keep perishables waiting for arrival. Holds, arrivals, resolutions, packages, and delivery prevent replacement. No preview automatically holds work or infers deletion. Live-source verification and reconciliation of physical work are still pending.

## Implemented locally

- Strict manifest validation separates preparation timing from storage class and preserves original requests. Imported orders do not require a customer account. Quantities, units, shelf location, source reference, and mapping version must be explicit.
- Independent advance-dry and after-arrival portions, including an explicit Not required state for an empty portion.
- Pure workflow operations for portion claims, line outcomes, coordinator exception approval, whole-portion packing, arrival revisions, gathering, whole-order handoff, holds, cancellation, departure, and coordinator resume.
- Domain guards for event/role scope, stale versions, ownership, pre-arrival perishable work, unapproved exceptions, duplicate package codes, and physical package custody before handoff.
- Arrival corrections preserve queue age; duplicate/older revisions do not create work. Held arrivals wait for review; delayed arrivals cannot reopen cancelled/departed orders.
- Fictional dry, produce, chilled, frozen, and baby-supply examples with 12 workflow tests. These fixtures are not approved operational mappings or allocation policies.

- Transactional creation with unique source reservations, command receipts, payload-conflict checks, and audit activity. Concurrent claims use a database transaction rather than relying on browser state.
- Event-scoped active staff grants are re-read inside every transaction. Events must explicitly be enabled and open; staff cannot submit arrival commands through this service.
- Staging locations reserve capacity for one order atomically. Physical gathering frees the location; cancellation preserves occupancy until goods are handled.
- Ten fulfillment emulator integration tests cover retries, competing claims, permissions, duplicate sources, competing locations, rollback, cancellation, gathering, denied direct access, pagination, and the authenticated dry API.
- A new `/staff/fulfillment` screen supports staff sign-in without a food-client profile, event selection by ID, paginated orders, dry claims, shelf-ordered item outcomes, coordinator exception approval, and verified packing at a staging position.
- The server feature flag defaults off. Dry endpoints verify the token, enabled/open event, and active staff grant. The dry HTTP surface accepts preparation only; it cannot trigger perishable work, arrival, or handoff. Coordinator endpoints separately require event coordinator access and can manage setup while an event is paused.
- Five-second refresh, stale/offline write prevention, and same-operation retries handle competing volunteers and uncertain save outcomes. Desktop and mobile captures were visually reviewed.

- A coordinator workspace creates separate disabled events, configures staging capacities, manages existing packer/runner accounts, and explicitly enables/pauses packing. Administrator bootstrap is checked inside the transaction; coordinator grants cannot be replaced by staff controls.
- Reviewed import previews accept explicitly mapped manifests, assign stable source-based order IDs, and classify new/unchanged/update/blocked records. Atomic apply reads only the saved preview and preserves all existing operational work. Duplicate IDs, changed manifests with existing work, stale setup, expired drafts, and conflicting source records block apply. This is not a live Google reader.
- Twelve coordinator emulator cases and one browser rehearsal cover setup, permissions, occupied locations, import idempotency, immutable preview/apply, blocked changes, and the transition from disabled setup to dry picking. CI now opts into Phase Two only for its emulator browser step.

Workspace details and limitations: [staff workspace](fulfillment-staff-workspace.md), [coordinator setup and imports](fulfillment-coordinator-workspace.md).

Code: [staff screen](../src/app/staff/fulfillment/DryPacking.tsx), [dry API](../src/app/api/fulfillment/dry/route.ts), [transactional store](../src/lib/fulfillment/store.ts), [store tests](../tests/fulfillment-store.test.ts), [model](../src/lib/fulfillment/model.ts), [workflow](../src/lib/fulfillment/workflow.ts), [tests](../tests/fulfillment.test.ts).

## Isolation from the pilot

Only the new, disabled-by-default Phase Two routes and APIs expose these workflows; original customer/admin screens and endpoints are unchanged. No Apps Script pilot source, printer configuration, Google resource, Firebase rule, customer-order handler, or deployed application was changed. The root unit and emulator test commands include the new tests alongside existing regressions; no dependency change was required. All work is on the dedicated `phase-two-fulfillment` Git branch. Planning and the initial domain foundation were recorded separately in commits `e1fdb56` and `eda6c0d`; the persistence layer is commit `bff1cde`. The dry staff workspace is commit `f1547c4`; coordinator setup and reviewed imports are a separate follow-up commit.

## Remaining work

The dry workspace works against explicitly provisioned records; it is not ready for a live pilot without source mapping and operational setup. Its endpoint derives UID from verified credentials and role from the event grant. Coordinator setup now provisions isolated events, positions, and grants for existing accounts. Account creation, additional coordinator provisioning, real Google-column mapping, live reading, and ongoing source reconciliation remain outstanding. All tests and rehearsals operate in emulators only. No existing event is enabled by this work. The first interface is English, uses coordinator-supplied event IDs, and stages all dry packages for a portion at one position; expanded event selection, language support, and multiple-position entry remain later improvements.

Live source import/reconciliation, removing/remapping existing lines on orders with work, standard-box walk-up manifests with unknown contents, package storage compatibility, exact item-to-package allocations, partial handoff/restock, moving/reassigning packages and work, and closeout are not implemented. The current command schema deliberately rejects partial handoff fields rather than treating them as full delivery. Approved shortages preserve supplied quantities in the resolution records; user-facing reduced/unserved outcome reporting remains to be built.

The arrival operation consumes already validated logical arrivals in memory. No bridge credentials, outbox, retry service, printing changes, or Google-to-Firebase integration exist yet. These require the failure and authorization checks in the [implementation plan](fulfillment-implementation-plan.md).

Next development slice: build source/allocation reconciliation for applied plans and physical work, including explicit handling of changed/deleted orders before a dry-preparation pilot. The current incremental preview never infers deletions or automatically holds existing orders; a blocked changed record requires coordinator resolution and is not an applied update. Keep all new functionality inactive for existing events. The check-in pilot remains independent until a separately tested and explicitly coordinated cutover.

## Verification

- All 19 unit tests pass (7 existing and 12 fulfillment).
- ESLint passes with zero warnings.
- All 8 browser tests pass (3 existing registration/printing regressions, 4 dry-workspace scenarios, and 1 coordinator/import rehearsal), including committed-save response loss, stale claims, offline/revoked access, and mobile-width layout.
- The optimized Next.js build passes with isolated, nonsecret test configuration and the feature flag disabled by default.
- A clean temporary copy installed the exact lockfile dependencies from the local npm cache. Standard TypeScript checking passes there without special exclusions.
- All 33 emulator integration tests pass (11 existing, 10 fulfillment-store/API, and 12 coordinator/import). The full 32-test suite passed before the final source-identity guard; all 12 coordinator tests were rerun after that guard. The emulator uses only `demo-food-source`; test setup explicitly checks the project and local emulator address.

The original workspace still has duplicated generated/type files and an incomplete nested `gaxios` installation. Rather than modify the pilot’s working environment, integration tests use a temporary source copy with clean dependencies and the existing temporary Java 21 runtime. No production credentials are passed to the emulator wrapper. Physical-pilot and live-integration checks remain outstanding. The standard workspace checks still require local dependency cleanup; the clean-copy results establish this milestone without modifying that environment.

### November 17 source preflight verification

The source-layout utility and CLI have seven regression cases covering matching layouts, missing requests/timestamps, drift, duplicates, wrong tabs, blank trailing cells, invalid inputs, and CLI exit codes. Existing fulfillment and core unit tests run alongside these. No application route, API, Firebase rule, pilot file, or runtime configuration was modified for this slice.

Validation for this slice: all 26 unit tests passed (19 existing plus 7 source-preflight cases), ESLint passed with zero warnings, and standard TypeScript checking passed in a temporary copy installed from the exact lockfile. The root workspace still fails typechecking on the pre-existing duplicate `node 2` types. No browser or emulator rerun was needed for this isolated CLI/library addition; earlier integration results above are historical.

### November 18 response-review verification

All 35 unit tests pass, including nine new cases for the actual header layout, explicitly acknowledged duplicates, lossless request-cell preservation, contact-column exclusion, ambiguous identities, layout drift, bounded CLI behavior and calendar routing across month/year boundaries. ESLint passes with zero warnings; standard TypeScript checking passes in the isolated exact-lockfile dependency copy. No application route, database operation or label-pilot file changed, so emulator/browser suites were not rerun for this library/CLI slice. Live importing remains unimplemented.

### November 18 allocation-planner verification

All 39 unit tests and 36 emulator tests passed. All eight browser tests passed with fresh isolated emulators, including existing registration and print routes. The final household-entry UI was additionally rehearsed in the coordinator browser test. Lint, standard TypeScript checking and the optimized build passed; dependency-sensitive checks used the isolated exact-lockfile copy. The initial combined integration/browser run encountered an emulator test-account email collision; separate fresh browser emulators resolved it without changes to production or pilot code. Desktop/mobile allocation screens were visually inspected. No production deployment or source write occurred.

### November 18 allocation-to-packing verification

All 41 unit tests passed. The full 41-case emulator suite passed, then the two additional household-binding/duplicate-item guard cases passed separately (43 emulator cases total). All eight browser tests passed after correcting explicit labels for the new linking selectors; the coordinator rehearsal includes applying the plan and picking its target quantity, plus mobile width checks. Standard TypeScript, lint and optimized build checks passed in the isolated dependency copy. The mobile linking preview was visually inspected. Pilot files, existing registration/order endpoints, Firebase rules and deployed settings were unchanged. No live import, Google write, push or deployment occurred.

## Reconciliation slice

Coordinator-reviewed full-order repacking now handles existing instruction and allocation changes after work begins. It holds work, requires physical goods and package accounting, checks stock across households, releases staging atomically and preserves arrival timing and audit history. See [procedure and limitations](fulfillment-reconciliation.md). Gathered/delivered corrections and multi-order stock reductions remain outside this slice. The label pilot and deployed application remain unchanged.

Validation for this slice: 42 unit tests, 48 emulator tests, type checking, lint and a production build passed. All eight browser regressions passed, including the reconciliation rehearsal and existing print routes; the reconciliation screen was visually reviewed.

## New-selection slice

Coordinators can now append explicitly reviewed selections during a held reconciliation, with item identity, quantity, unit, shelf, food category, stock confirmation and reason. Existing item identities remain protected; duplicate item additions are rejected. Shelf-stable items enter dry work, while produce and other perishables remain gated by check-in. Released item budgets include the added share atomically and reject concurrent overspending. Items without a plan use manually reviewed quantities without inventory reservation. See [procedure and boundaries](fulfillment-reconciliation.md).

The label/check-in pilot, production deployment and Google sources remain unchanged. This implementation remains behind the default-off Phase Two gate.

Validation for the new-selection slice: 42 unit tests and all 55 emulator cases passed (54 in the full run, plus the additional household-binding case in a focused run). All eight browser regressions passed, including new dry/produce selections, post-apply dry picking and existing print routes. Type checking, zero-warning lint and the production build passed. The mobile reconciliation screen was visually reviewed. No pilot files, production data or deployment configuration changed.
