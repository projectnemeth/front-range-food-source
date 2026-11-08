# Phase Two fulfillment implementation status

Updated November 8, 2026. Fifth development slice: reviewed source changes for unstarted orders, behind the Phase Two feature gate. No deployment, production data access, or pilot integration has occurred.

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

Live source import/reconciliation, changes to orders with existing work, standard-box walk-up manifests with unknown contents, package storage compatibility, exact item-to-package allocations, partial handoff/restock, moving/reassigning packages and work, and closeout are not implemented. The current command schema deliberately rejects partial handoff fields rather than treating them as full delivery. Approved shortages preserve supplied quantities in the resolution records; user-facing reduced/unserved outcome reporting remains to be built.

The arrival operation consumes already validated logical arrivals in memory. No bridge credentials, outbox, retry service, printing changes, or Google-to-Firebase integration exist yet. These require the failure and authorization checks in the [implementation plan](fulfillment-implementation-plan.md).

Next development slice: verify the complete real-source field mapping and build source reconciliation, including explicit handling of changed/deleted orders before a dry-preparation pilot. The current incremental preview never infers deletions or automatically holds existing orders; a blocked changed record requires coordinator resolution and is not an applied update. Keep all new functionality inactive for existing events. The check-in pilot remains independent until a separately tested and explicitly coordinated cutover.

## Verification

- All 19 unit tests pass (7 existing and 12 fulfillment).
- ESLint passes with zero warnings.
- All 8 browser tests pass (3 existing registration/printing regressions, 4 dry-workspace scenarios, and 1 coordinator/import rehearsal), including committed-save response loss, stale claims, offline/revoked access, and mobile-width layout.
- The optimized Next.js build passes with isolated, nonsecret test configuration and the feature flag disabled by default.
- A clean temporary copy installed the exact lockfile dependencies from the local npm cache. Standard TypeScript checking passes there without special exclusions.
- All 33 emulator integration tests pass (11 existing, 10 fulfillment-store/API, and 12 coordinator/import). The full 32-test suite passed before the final source-identity guard; all 12 coordinator tests were rerun after that guard. The emulator uses only `demo-food-source`; test setup explicitly checks the project and local emulator address.

The original workspace still has duplicated generated/type files and an incomplete nested `gaxios` installation. Rather than modify the pilot’s working environment, integration tests use a temporary source copy with clean dependencies and the existing temporary Java 21 runtime. No production credentials are passed to the emulator wrapper. Physical-pilot and live-integration checks remain outstanding. The standard workspace checks still require local dependency cleanup; the clean-copy results establish this milestone without modifying that environment.
