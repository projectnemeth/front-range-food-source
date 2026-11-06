# Fulfillment implementation plan

Reviewed November 6, 2026. Companion: [workflow specification](fulfillment-workflow-spec.md). This plan covers the new fulfillment extension; the earlier [label plan](pickup-labels/implementation-plan.md) covers the standalone printing pilot only. Its time estimates do not estimate this extension.

Development can start using fictional data. A live pilot requires complete source mapping, production-baseline verification, and on-site validation. This document specifies intended changes, not implemented capabilities.

## Architecture decisions

Keep Google Forms/Sheets as the initial intake source. Keep the Apps Script pickup interface as the sole arrival capture and printing interface for an enabled event. Firebase owns fulfillment work, package locations, and delivery. The new Next.js staff screens consume that fulfillment state. Preserve Blue/Orange line, three-digit number, optional vehicle, check-in without printing, walk-ups, deliberate reprints, and existing print recovery.

Use a separate `fulfillmentOrders` collection rather than inserting Google responses into customer `orders` with invented Firebase user IDs. An imported household does not need an account or email address. Store an optional reference to a native application order when that is the selected intake source. Do not modify customer registrations to satisfy staff workflow requirements.

Each fulfillment order has event ID, source reference and revision, immutable original-request snapshots, current approved manifest, two portion records, review/hold flags, version, and delivery outcome. Use child records for lines, packages, activity, and operation receipts. Store event settings, source mappings, locations, staff grants, and integration receipts separately. Keep contact data out of general queue responses.

An event configuration maps the Apps Script event ID and selected source spreadsheet/tab to exactly one fulfillment event. A reviewed registration mapping identifies one fulfillment order. Match using stored source keys and explicit review, never by name/phone alone. Food Bank ID duplicates remain held. Native order imports use their native document IDs. Cross-source overlaps require explicit reconciliation; select one source per pilot event.

Two fixed work portions are sufficient initially: `advanceDry` and `afterArrival`. Stage and storage class are independent catalog fields. Produce is after-arrival even when ambient; frozen goods are after-arrival. Diapers, formula, household goods, and free-text requests must be mapped to concrete lines or reviewed dispositions rather than omitted. Empty portions are explicitly Not required. Version the event mapping and allocation rules so edits do not silently change already packed orders.

## 1 Establish contracts and fixtures

Read the repository’s Next.js guidance before implementing. Capture the current local baseline and separately verify deployed versions before planning cutover. Existing deployment notes are not evidence that production matches local code.

Create fictional fixtures covering both stages, quantities and category-only requests, missing dietary data, repeated source IDs, edited/deleted submissions, dry-only and perishable-only orders, multiple packages, and walk-ups. Specify typed schemas for imports, portions, package custody, commands, arrivals, revisions, and outcomes. Every write includes an operation ID and expected record version; a reused operation ID with a different payload fails rather than silently succeeding.

Exit: fixtures preserve source meaning, and state-transition tests cover pre-arrival gating, empty portions, cancellation, departure, shortages, and delivery outcomes. Live food-column mapping is an explicit remaining input, not a guessed schema.

## 2 Build permissions and the fulfillment domain

Implement server modules and authenticated endpoints for import preview/apply, claim/reassign/pause, line outcomes, exception decisions, packing, staging/moving, retrieval, handoff, and closeout. Validate authorization, event mode, cancellation, revision, and relevant arrival state on every command. A claim is scoped to a portion; a runner separately owns final assembly and handoff. Record operator and device/session context in activity history.

Use existing Firebase authentication for the first internal staff pilot, with explicit event-scoped grants for coordinator, packer, and runner. Staff accounts need no food-client profile. Keep existing enrolled-device access for greeters in Apps Script; those device credentials are not Firebase credentials and must not be accepted as such. Coordinator privileges remain server-validated. A later shared-device enrollment flow for packing requires its own authorization design; an operator-name dropdown alone does not grant access.

Deny direct browser writes to new operational collections. Staff read endpoints enforce role-specific response fields. Transactions protect claims, package moves and occupancy, handoffs, and idempotency receipts. Keep external calls outside retried database transaction callbacks.

For fulfillment-managed events, disable the legacy admin packed checkboxes and reject their direct Firestore writes in rules, not just the UI. Render a derived summary/link instead. Preserve the old path only for explicitly unmanaged events. A legacy PACKED flag cannot establish package count, location, arrival, or a complete manifest; require coordinator verification to adopt existing work. Do not automatically translate it into fully ready status.

Exit: emulator tests prove cross-role/event isolation, competing claims, rejected stale writes, no legacy bypass, and no perishable picking without arrival. Customer ordering behavior remains covered by existing regression tests.

## 3 Build reviewed import and dry preparation

Implement a read-only source adapter with explicit column/question mapping, schema version, event binding, source revision, and bounded pagination. Prefer an authenticated server-side Google reader; its account must be granted the exact source access needed. If an Apps Script export is used instead, apply the same authenticated integration envelope described below. Never use a public response sheet or browser-held credentials.

Preview counts and validation issues before applying. Reimports preserve stable fulfillment IDs. Source changes during active work create review revisions rather than overwriting work. Source removal with claims or packages creates a hold, even before arrival. Unmapped selections or ambiguous units block release of affected orders. Coordinator-approved quantities and event rules become a saved manifest. Missing food columns block live picking but do not block development with fixtures.

Add dry queue, portion checklist, pack verification, package identity, locations, and exception review. Use stable package codes and event identity. Prevent location conflicts transactionally. For partial package handoff/restock, require item quantities allocated to those packages; without that allocation, allow only whole-portion actions. Do not offer ambiguous partial actions that imply known delivered contents.

Pilot dry preparation independently while existing paper/perishable pickup continues. Assign an explicit subset of orders to the pilot and export a dated fallback roster; do not run two independent picking queues for them.

Exit: importing twice adds no duplicates; changing headers fails visibly; two pickers cannot take one portion; shelf order and dietary notes persist; staged goods survive source removal; changing package counts does not invalidate existing package identities.

## 4 Connect arrival reliably

Add a server-to-server integration endpoint with an event-scoped credential stored only in Apps Script properties and backend secrets. Sign timestamped request bodies with HMAC, identify the key version, reject stale or invalid signatures, and support revocation/rotation. Store durable idempotency receipts so a freshly signed retry of the same logical message is harmless. Scope the integration to arrival/upsert metadata and mapped walk-ups, never arbitrary packing or coordinator actions.

Use a stable logical arrival ID based on station deployment, event, and registration, independent of print-job ID. The envelope includes that ID, registration/source reference, source revision, monotonic arrival revision, event mapping, checked-in time, line, pickup number as text (preserving leading zeroes), optional vehicle, and origin device. Backend receipt time is separate from arrival time. Reject unknown mappings and retain them for repair; do not create an empty regular order and mark it ready.

In Apps Script, persist a durable integration-pending marker with the arrival and reconcile all checked-in registrations against acknowledged revisions. A Sheet script lock is not a multi-record transaction: repair interrupted marker/job/registration writes using the existing recovery paths plus reconciliation. Cover normal check-in, check-in without printing, recovered jobs, and walk-ups. Advanced labels and reprints alone are not arrivals. Car-detail corrections increment arrival revision without creating a new task or resetting queue age.

Attempt delivery immediately after durable arrival capture, independently of print success. While the station screen is open, retry pending logical messages on a bounded cadence; provide coordinator retry and a background reconciliation trigger for eventual repair. Do not depend on an open browser for durability, or claim a coarse background trigger guarantees a five-second queue. Backend acknowledgement, screen refresh, and printing have distinct states.

The backend transaction stores the accepted arrival revision and releases the after-arrival portion once, only when the order is active and not held. If the order is held, arrival is visible but work remains blocked until review is resolved; resolving the hold re-evaluates release. Older revisions cannot overwrite corrected car details. Closed/cancelled/departed work cannot be revived by delayed delivery. Repeated receipt returns the previous outcome.

Existing labels may physically print before Firebase acknowledges arrival. The packing screen must show Pending integration and prohibit digital claims until acknowledgement. If the team acts on a label during an integration outage, the coordinator assigns that work to the documented paper fallback; replay reconciles that work before releasing new digital tasks. Never silently allow both paths to pack the same order.

Walk-ups get a stable station-generated registration reference and an event-approved standard-box template. Assign a physical box once; do not create fake item contents. Unknown standard-box contents may be tracked at package level, with item-level reporting explicitly unavailable. Include perishable additions only when the event template defines them.

Exit: fault-injection tests interrupt each arrival/outbox/acknowledgement write boundary and prove eventual recovery without duplicate work. Test invalid credentials, rotated keys, stale and reordered messages, corrected car details, no-print arrivals, walk-ups, held orders, cancellation, and printed-label/pending-integration fallback.

## 5 Build perishable packing and final handoff

Add an oldest-arrival-first perishable queue, claims and checklist, progress, and exceptions. Preserve arrival priority after reassignment. Coordinator reprioritization records a reason. Dry retrieval can proceed in parallel; readiness requires verified manifests and physical package custody, not just known storage locations.

Use the same package controls for produce, refrigerated, and frozen items, with appropriate storage classes. Ready for handoff requires all intended packages gathered at the handoff point under the responsible runner. Final confirmation checks household, current line/number, and package IDs. Record immutable handoff events and distinguish full/reduced fulfillment from none/partial/complete delivery. Resolving an undelivered remainder does not retroactively deliver it; zero handoffs means unserved.

Add departure, cancellation, return/resume, and no-show closeout. Coordinator resume reuses existing package/work records rather than creating another order. Already handed-over records remain historical; corrections require explicit audited adjustments. No-show processing deals only with actual prepared packages. Restock is a physical disposition record, not automatic inventory accounting.

Refresh active screens within a proposed five-second interval and show stale status after fifteen seconds without success. Block writes on disconnection; stale snapshots never overrule server checks. Test pagination across the full event, not just the admin screen’s first 50 orders. Refresh on focus and show actionable conflicts instead of silently replacing local progress.

Exit: end-to-end scenarios prove dry packing before arrival, perishable packing only after arrival, parallel retrieval, no missing-bag handoff, safe partial actions, corrected car details, no-show handling, and stale-device rejection.

## 6 Verify and release in controlled stages

Run relevant unit, emulator, Apps Script service-mock, and browser tests as each layer lands. At the release candidate, run repository lint/typecheck and existing ordering/printing regressions plus the new fulfillment scenarios. Test both accepted and denied staff roles. Mock tests do not establish Google execution, quotas, network latency, or physical output.

Before live import, the coordinator validates complete food/notes mapping and stage/quantity rules using an authorized bounded sample. Before live pickup, validate staff accounts, Google authorization, arrival acknowledgement with two iPads, queue refresh at expected event volume, printer output, site Wi-Fi, car-number corrections, and the outage drill. Record measured latency rather than inferring it from the five-second design target.

Review actual deployed application/rules/indexes against the local baseline and the existing [deployment procedure](deployment.md). Use an additive schema and event-specific feature flags. Start with a new or explicitly reconciled event; avoid automatic migration of active packing. Back up affected data, prepare indexes, and verify permissions before enabling staff writes. A managed event has one authoritative fulfillment writer and one arrival capture path.

Pilot order: fictional full-flow rehearsal, limited dry-preparation pilot, then connected pickup pilot with coordinator support. The connected pilot requires a packing screen that shows task ownership and integration state; the old label-only operating mode is insufficient for digital fulfillment.

Rollback: pause new digital claims, export/reconcile all accepted work and handoffs, assign paper ownership, and disable the event feature. Preserve arrival receipts and completed operations; do not reset state or re-enable legacy packed toggles for unreconciled managed orders. Resume only after paper changes are reconciled and stale sessions refresh.

Exit: all specification acceptance scenarios pass, the coordinator completes a representative rehearsal, and remaining site issues are resolved. Name the support owner and agree retention and recurring operating costs before broad rollout.

## Readiness boundaries

Ready now: domain/schema work, fictional fixtures, permissions, dry workflow, integration contracts, and automated verification. Source mapping and site validation can proceed alongside this work.

Required before live data: authorized full source mapping, event identity reconciliation, quantity/stage rules, account access, and privacy/retention configuration.

Required before live pickup: deployed-baseline review, reliable bridge and recovery, physical printer/network validation, an operational packing screen, and a successful fallback rehearsal. These are release gates, not reasons to postpone all development.
