# Phase Two fulfillment implementation status

Updated November 6, 2026. Second development slice: isolated domain model plus transactional persistence and event-scoped staff grants. No deployment, production data access, or pilot integration has occurred.

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
- Eight emulator integration tests cover retries, competing claims, permissions, duplicate sources, competing locations, rollback, cancellation, gathering, and denied direct database access.

Code: [transactional store](../src/lib/fulfillment/store.ts), [store tests](../tests/fulfillment-store.test.ts), [model](../src/lib/fulfillment/model.ts), [workflow](../src/lib/fulfillment/workflow.ts), [tests](../tests/fulfillment.test.ts).

## Isolation from the pilot

No existing app screen or endpoint imports these modules. No Apps Script pilot source, printer configuration, Google resource, Firebase rule, customer-order handler, or deployed application was changed. The root unit and emulator test commands include the new tests alongside existing regressions; no dependency change was required. All work is on the dedicated `phase-two-fulfillment` Git branch. Planning and the initial domain foundation were recorded separately in commits `e1fdb56` and `eda6c0d`; the persistence layer is a separate follow-up commit.

## Remaining work

This is a foundation, not a usable staff application. The internal store takes a UID that a future endpoint must authenticate; it derives the event role from server-managed grants rather than accepting a caller-supplied role. Grant provisioning, authenticated HTTP endpoints, role-specific read responses, and the staff interface remain to be built. Tests seed staff/event/location documents in the emulator only. No existing event is enabled by this work.

Import preview/reconciliation, source-change handling, standard-box walk-up manifests with unknown contents, package storage compatibility, exact item-to-package allocations, partial handoff/restock, moving/reassigning packages and work, and closeout are not implemented. The current command schema deliberately rejects partial handoff fields rather than treating them as full delivery. Approved shortages preserve supplied quantities in the resolution records; user-facing reduced/unserved outcome reporting remains to be built.

The arrival operation consumes already validated logical arrivals in memory. No bridge credentials, outbox, retry service, printing changes, or Google-to-Firebase integration exist yet. These require the failure and authorization checks in the [implementation plan](fulfillment-implementation-plan.md).

Next development slice: authenticated staff endpoints and the digital dry-preparation interface, with an explicit feature gate and role-specific responses. Keep all new functionality inactive for existing events. The check-in pilot remains independent until a separately tested and explicitly coordinated cutover.

## Verification

- All 19 unit tests pass (7 existing and 12 fulfillment).
- ESLint passes with zero warnings.
- A clean temporary copy installed the exact lockfile dependencies from the local npm cache. Standard TypeScript checking passes there without special exclusions.
- All 19 emulator integration tests pass (11 existing and 8 fulfillment). The emulator uses only `demo-food-source`; test setup explicitly checks the project and local emulator address.

The original workspace still has duplicated generated/type files and an incomplete nested `gaxios` installation. Rather than modify the pilot’s working environment, integration tests use a temporary source copy with clean dependencies and the existing temporary Java 21 runtime. No production credentials are passed to the emulator wrapper. Browser and physical-pilot checks remain for later milestones that introduce interfaces and integration.
