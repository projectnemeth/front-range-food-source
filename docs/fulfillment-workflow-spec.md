# Front Range Food Source fulfillment workflow and software specification

Reviewed for implementation • November 6, 2026

Build sequence and release gates: [Fulfillment implementation plan](fulfillment-implementation-plan.md). Review findings: [Readiness review](fulfillment-readiness-review.md).

Build a staff web app that follows each order from Google Form intake through picking, packing, storage, and handoff to the household. Replace the printed checklist while preserving the confirmed two-stage workflow: prepack dry and shelf-stable goods and stage them alphabetically; pack refrigerated goods, produce, and other perishables only after the car checks in. Give every physical package an identity and a recorded location so that pickup volunteers can find the entire order reliably.

The recommended first release is a mobile-friendly extension of the existing food-order application, with a Google response importer. Clients can continue using the Google Form. Volunteers use phones or tablets; coordinators use a larger screen. Home-screen installation as a progressive web app can make access convenient, but reliable shared order state matters more than installation.

## Context and design assumptions

The user confirmed that dry and shelf-stable goods are packed before pickup, while refrigerated goods, produce, and other perishables are packed only after the car checks in. Preserving this timing is a requirement. Perishable work waiting for arrival is normal, not a late order or exception. Frozen items belong to the arrival-triggered perishable work. Preparation timing and storage class are separate: produce can wait for arrival even when it is not refrigerated.

Front Range Food Source identifies itself as the former Rock Church Food Bank. Its site describes twice-monthly Saturday drive-up distribution, a Monday 4 p.m. order cutoff, and unpacking and restocking missed orders. These practices favor an event-based preparation queue and explicit handling of cancellations and leftovers. [Front Range Food Source](https://frontrangefoodsource.org/)

The relevant church page is **therock.org/foodbank**, rather than rock.org/FoodBank. It describes 100–150 families per Saturday, refrigerated and frozen donations, and a prepacked box for people arriving without orders. Use that volume only as an initial planning reference; measure actual orders and peak arrivals. The Front Range site uses “people” for a similar range, so the two figures are not interchangeable. [The Rock Food Bank](https://www.therock.org/foodbank/)

The public ordering link opened a form titled for November 7, 2026, with a Food Bank ID question on page one of three. That establishes a current public intake path, not the complete item schema. [Public order form](https://docs.google.com/forms/d/e/1FAIpQLSf-3Ryrki8ZMfUIZ02cK7RNfOVXjZJmqCrxX5pet11KM7ThWQ/viewform)

Local project evidence provides a useful starting point:

- The existing Next.js/Firebase application includes an item catalog, household and dietary information, printing, and separate dry/fresh packed flags. See [order schema](../src/lib/schemas.ts), [catalog](../src/lib/catalog.ts), and [admin screen](../src/app/admin/page.tsx).
- A standalone pickup-label pilot covers arrival and printing, but does not track packing completion or collection. Its arrival labels remain the signal to start the perishable portion and retrieve the existing dry portion of the same order. Preserve its Blue/Orange line, three-digit pickup number, vehicle description, walk-up, and printing workflows. See [pickup-label specification](pickup-labels/phase-one-spec.md).
- The recorded Sheet mapping establishes identity fields but not the complete food-selection mapping. Repeated Food Bank IDs were found in a dated tab. IDs alone cannot safely identify submissions. See [source mapping](pickup-labels/source-sheet-mapping.md).
- Local implementation does not establish what is running in production. Existing deployment, data migration, and physical printer checks remain prerequisites where applicable. See [implementation status](implementation-status.md).

The two-stage preparation timing is confirmed. The software details below are proposals. A short observation should establish shelf layout, box counts, volunteer roles, and the item-to-stage mapping without reopening that timing decision.

## Choosing the picking method

| Method | How it works | Benefit | Cost or risk | Recommendation |
| --- | --- | --- | --- | --- |
| One volunteer per portion | A volunteer handles the dry portion in advance; an arrival-stage volunteer handles perishables after check-in | Familiar; clear ownership within each stage | Requires linking both portions | Start here |
| More zones within each stage | Split work among shelf or perishable zones while preserving the arrival gate | Work can happen in parallel | More portions must be reunited correctly | Add after package tracking works |
| Several orders on one cart | Pick common items once into separately marked totes | Less walking | More sorting and mixing risk | Pilot later with a small cart |
| Standard boxes plus requested extras | Prepare common contents in bulk and add household choices | Efficient when contents are truly standard | May conflict with client choices or dietary needs | Use for walk-ins; assess separately for regular orders |

Software should first reduce ambiguity and searching. Batch picking is worthwhile only if observation shows walking is the dominant bottleneck.

## Proposed order of operations

### 1. Prepare the pickup event

The coordinator selects an explicit event date, imports its orders, and reviews duplicate or incomplete records. Never infer the active event from the most recently populated tab. Store event schedules in America/Denver and show the event date prominently on every screen.

Define the shelf walking sequence and staging positions before volunteers begin. Examples are Pantry 01, Pantry 02, Table B position 04, Cooler shelf 02, and Freezer bin 01. These are illustrative labels, not a map of the current facility.

Assign quantities where the source only records selections. “Rice requested” does not establish a quantity or package size. A coordinator can define an event allocation rule, such as a selected category receiving an agreed number of units, with household-size variations where appropriate. Preserve the original request alongside the packing instruction. Unknown quantities or units require review before release.

Show aggregate demand by item to help staff prepare shelves and identify likely shortages. Label it requested demand, not verified stock availability. Freeze a working order revision when picking begins; later changes become visible revisions requiring review.

### 2. Claim the dry portion before pickup

A volunteer taps **Start next dry order**. The app assigns an eligible dry portion and makes its ownership visible to everyone. A second volunteer cannot claim that same portion simultaneously. Perishable requests can be viewed for planning, but cannot be claimed, picked, or marked packed before recorded check-in. Enforce this gate on the server as well as in the interface.

Show household name, event order number, household size, relevant dietary requests, baby-supply details, and notes. Use a cart or tote marked with the order number from the first item picked. A small identity label remains useful even when the checklist is digital.

Support **Pause**, **Needs help**, and coordinator reassignment. A disconnected device must not automatically release work: food may already be on its cart. Reassignment requires confirming the physical cart or boxes and preserving completed work.

### 3. Pick in shelf order

Display the active portion’s items in the sequence volunteers encounter them physically. Do not force the walk to follow the order of questions on the form. Use large touch targets and one-tap completion for the normal case.

Each line shows the requested item, intended quantity and unit, shelf location, and actual outcome. Outcomes are **Picked**, **Partially filled**, **Substituted**, **Unavailable**, or **Needs help**. Partial picking records both packed and missing quantities; delivery is recorded separately at physical handoff. Substitutions record the actual replacement and quantity.

Special instructions remain visible while scrolling. Missing dietary information displays as “Not recorded,” not “No restrictions.” Substitutions involving a recorded dietary requirement, unspecified formula, or other ambiguous need go to the coordinator; the software must not assume equivalence. Track the decision and original request.

Allow undo with history. Product barcode scanning is optional later because donated products and packaging can vary; package identification delivers more immediate value.

### 4. Pack and verify

The volunteer places picked items into physical packages and records each package separately. “Package” includes a box, bag, or bulky item that travels separately. The first release uses two work portions: advance dry and after-arrival perishables. Packages within either portion have separate storage classes, such as ambient, chilled, or frozen. Associate item quantities with individual packages before permitting a partial handoff or partial restock; otherwise permit only whole-portion handoff/disposition so the system cannot invent which items traveled in a particular box.

Before a portion is marked packed, every line must have an outcome. A shortage is a resolved exception only after the coordinator accepts the reduced fulfillment; checking it off must not silently imply it was supplied. Require a check of dietary notes, baby supplies, extras, and package count. A second person can verify exceptional orders without requiring two people for every routine order.

Before arrival, complete only the dry portion; unstarted perishables do not block the **Dry staged — awaiting arrival** milestone. After check-in, use the same picking and verification controls for the perishable portion. Cold stock and any completed cold packages remain in suitable storage under the food bank’s established handling procedures. Software records location and retrieval, and can later support locally approved time alerts; it does not determine handling policy.

### 5. Label and stage every package

Give each package a stable code linked to the event and order, such as **Event Nov 7 / Order 042 / Dry D1**. Use the name or established household identifier as a human-readable cross-check. Package codes never change when another package is added; display the current total in the app rather than embedding a changing total in package identity. Codes and QR links must not expose contact details to unauthenticated viewers.

Keep alphabetical table areas initially, but add exact positions. Before arrival, the app might show two dry boxes at **Table B 04**, with perishables **Waiting for check-in**. After arrival and perishable packing, it also records each produce, chilled, or frozen package’s current location, including a handoff station or appropriate cold-storage position if it must wait. A name is a lookup aid; it is not a reliable location or unique order identifier.

Record placement before declaring a package staged. Moving a package requires updating its location. A position can hold several packages from one order; prevent accidental mixing with another order unless the location is explicitly configured as shared storage with distinguishable bins. Show occupancy and full locations.

Use temporary handwritten codes if printing fails. Completion of a print job does not establish that a label was attached or a box was staged. Package identification labels are an additional layout. Preserve the existing arrival label, including Blue/Orange line, three-digit pickup number, and vehicle description. The pickup number identifies the car; package codes identify food linked to that arrival.

### 6. Check the household in

Keep the existing pickup interface: the greeter searches for the household, verifies the match, uses the device’s Blue/Orange line, enters the three-digit pickup number, and optionally records a vehicle description. **Check in & print** records arrival and sends the existing arrival label. People do not need a phone, QR code, or app to receive food.

Check-in releases the perishable portion into an oldest-arrival-first packing queue and exposes the dry-package locations for retrieval. A volunteer claims **Pack perishables** for that order; another may retrieve dry boxes in parallel. Show **Arrived — perishables queued**, then **Packing perishables**, then **Ready for handoff** once both portions are verified and accounted for. Normal perishable work does not require a coordinator alert; missing dry preparation, shortages, or excessive waits do. Repeated check-in and label reprints reuse the same arrival and work records, never starting a second perishable portion. A printer failure leaves arrival and eligible packing work recorded, with the existing label-problem warning. Orders with no perishable requests skip that portion explicitly and can proceed to retrieval after check-in.

Walk-ins use the existing prepacked walk-up interface and receive a separately recorded standard-box request according to the organization’s policy. Allocate an existing physical standard box once; unknown contents remain explicitly unknown, not a fabricated item checklist. Perishable work is Not required unless an approved event template includes perishable additions; those still release only after arrival. They should not appear as missing advance orders or require completion of a full client registration at the curb.

### 7. Retrieve and hand over the complete order

A runner can retrieve existing dry packages while perishable packing proceeds, but cannot confirm full handoff until the perishable portion is complete or its exceptions are explicitly resolved. The runner sees all package codes and locations. Confirm each package by scanning or a large manual confirmation button, with the package code visible. The app flags missing cold or specialty portions before handoff.

The runner confirms the intended household at the car and taps **Handed over** only after physical delivery. If several people retrieve portions, one runner owns the final handoff. For an approved partial delivery, record exactly what was delivered and keep remaining packages open; do not mark the whole order collected.

### 8. Close the event

After distribution, the coordinator reviews uncollected orders, missed arrivals, cancellations, and unresolved partial deliveries. A household that never checked in should have only prepacked dry packages to process; its unreleased perishable work is closed without inventing packed goods or stock returns. Create unpacking/restocking work for remaining packages. Record package disposition as restocked, discarded under existing policy, or another approved outcome.

An order marked “No-show” must not automatically increase inventory or free its occupied position. Those changes happen after someone physically processes the packages. Close the event only when remaining work has an owner or a recorded disposition.

## Screens volunteers need

| Screen | Primary job | Essential information |
| --- | --- | --- |
| Event overview | Coordinator sees progress and bottlenecks | Dry preparation progress, awaiting arrival, perishables queued/packing, ready, delivered, exceptions; last import and sync times |
| My portion | Picker follows the shelf route | Dry or arrival-triggered perishable work, quantities, locations, restrictions, outcomes, help and pause |
| Perishable queue | Packer starts work for checked-in cars | Arrival time, Blue/Orange line, pickup number, dry status/location, perishables, owner and waiting time |
| Pack and stage | Packer accounts for physical packages | Portion, package count and codes, verification, label action, location assignment |
| Arrival search | Existing greeter workflow releases perishable work | Event, identity, dry status, Blue/Orange line, three-digit pickup number, optional vehicle description |
| Runner queue | Runner gathers and delivers food | Waiting time, ownership, all package locations, remaining portions, handoff |
| Exceptions | Coordinator resolves interrupted work | Duplicates, changes, shortages, cancellations, abandoned assignments, partial deliveries |

Illustrative picker screen using fictional data:

```text
ORDER 042     EXAMPLE HOUSEHOLD     4 PEOPLE
Dry portion   •   Assigned to Alex
Dietary request: 1 gluten-free household member

Pantry 01   Rice          2 bags     [Picked]
Pantry 02   Black beans   3 cans     [Pick] [Issue]
Pantry 03   Pasta sauce   1 jar      [Pick] [Issue]

3 of 8 lines resolved       [Pause] [Needs help]
```

Illustrative runner screen:

```text
ORDER 042     Blue #123     Waiting 4 minutes
[ ] Dry 1     Table B 04
[ ] Dry 2     Table B 04
[ ] Chilled 1 Cooler 02
[ ] Frozen 1  Freezer 01

0 of 4 packages gathered
[Confirm household and hand over]
```

Use text and icons as well as color, readable type, few taps, and explicit saved/error feedback. Support the languages staff actually need; preserve client notes without silently replacing their meaning through automatic translation. Choose the volunteer’s role once per session rather than requiring navigation through administrative screens.

## Status and readiness rules

One linear order status cannot describe a household that has arrived while its frozen portion is unfinished. Track preparation and attendance separately, and compute the overall display from them.

| Record | States or outcomes |
| --- | --- |
| Dry portion | Unclaimed → Picking → Packed → Staged; explicit Not required when empty; hold flag with reason |
| Perishable portion | Waiting for check-in → Queued → Picking → Packed → Accounted for at handoff or storage; explicit Not required when empty |
| Item line | Pending, picked, partial, substituted, unavailable, needs review |
| Attendance | Not arrived, arrived, departed unserved, no-show |
| Package | Packing, stored, retrieved, handed over, restocked, other recorded disposition |
| Order delivery | None, partial, complete |
| Order control | Active, cancelled; review flags and revision |

**Dry ready for retrieval** means the dry portion is staged; it may be retrieved after arrival while perishables are packed. **Ready for handoff** means the household has checked in, all required lines have accepted outcomes, both preparation stages are complete or explicitly not required, and every intended package has been physically gathered under the responsible runner’s custody at the handoff point. Merely being stored at known locations is not ready for handoff. An accepted shortage can make an order operationally ready, but the display must still identify it as reduced fulfillment. If no food/packages can be supplied, route the order to coordinator resolution as unserved instead of the runner queue. **Complete delivery** requires a physical handoff of all packages on the final approved manifest and at least one package delivered. Preserve a separate full/reduced fulfillment outcome against the original request. Resolving missing food without delivery closes the order as unserved or partial, never as complete delivery. Closing remaining obligations does not rewrite historical handoff quantities.

Before arrival, show **Dry staged — awaiting arrival** and **Perishables — waiting for check-in**. This is successful advance preparation. It must not appear as overdue or fully ready for handoff. After arrival, measure perishable queue and packing time separately from dry retrieval time.

Changes to item requirements, package counts, or dietary instructions invalidate affected readiness. Cancelled work cannot be newly claimed or completed; every write rechecks cancellation and record version, including an already assigned volunteer’s write. Departure before service pauses remaining work and requires package disposition or an explicit coordinator resume. Delayed arrival messages cannot reopen cancelled, departed, or closed orders. Cancellation retains the physical package records until they are dealt with. Corrections and reopening require a reason and preserve history.

## Data and integration design

| Record | Minimum fields |
| --- | --- |
| Event | ID, pickup date, cutoff, open/closed state, source selection, allocation rules |
| Order | Internal ID, event, household reference and snapshot, source keys/revision, requests, review flags |
| Line | Original request, normalized item, preparation stage, storage class, requested/allocated quantity and unit, actual quantity, outcome, replacement, decision |
| Portion | Order, preparation stage (advance dry or after arrival), release arrival ID/time, required lines, owner, preparation state, verification |
| Package | Stable ID, order/portion, display code, current location, state, retrieved/delivered timestamps |
| Location | Code, storage class, capacity/occupancy policy, active state |
| Arrival and delivery | Order, arrival time, lane, runner, package handoffs, remaining work |
| Activity | Actor, action, record, previous/new value, time, reason, retry identifier |
| Import run | Source/event, counts, field mapping version, errors, last successful sync |

Give the fulfillment system its own stable order IDs. Store Google provenance separately. A direct Forms adapter can retrieve response records after authorization; the Forms API supports reading form content and responses. [Google Forms API](https://developers.google.com/workspace/forms/api/guides/retrieve-forms-responses)

For the current Sheet path, preserve the existing explicit event selection and duplicate-review behavior. Row number, name, and Food Bank ID alone are insufficient durable keys. Import each reviewed source record once; preserve its identity across sorting and refreshes. Never merge distinct households merely because their IDs match.

Map all food selections, notes, dietary information, baby needs, quantities, and household fields before calling the importer complete. The existing identity mapping is insufficient to produce a picking checklist. Preserve unmapped fields for review rather than dropping them. Fail the affected import when expected headers change. The app’s catalog is a starting vocabulary, not proof that it matches the Google Form.

Keep the Google source read-only initially. Import changes before picking directly; after picking begins, show a revision comparison and let the coordinator reconcile it. Source deletion must not erase an order with claimed work, packed goods, or an arrival. Hold it for review and preserve its package locations, even if the household has not arrived. Do not overwrite work completed by volunteers during a refresh.

For a transition involving both the Google Form and the existing ordering app, select one intake authority per event or explicitly reconcile overlap. Do not run two independent arrival or packing queues for the same event. Retain Apps Script as the arrival capture and printing service during this build; bridge its durable arrival records into Firebase fulfillment using an explicit event/registration-to-order mapping. Do not expose a second independently writable check-in interface for the same event. Firestore owns preparation, packages, and handoffs; Google source responses remain intake evidence.

## Recommended implementation approach

Extend the existing Next.js/Firebase application with staff routes for dry picking, staging, arrival-triggered perishable packing, and runners. Connect the existing Apps Script pickup interface to one authoritative fulfillment record; retain its check-in, line/number, vehicle, walk-up, and printing behavior rather than rebuilding these as unrelated features. Arrival must durably release exactly one perishable task per applicable order. If crossing services, persist an arrival event for retryable delivery, deduplicate by arrival ID, and show an integration-pending/error state until acknowledged; do not claim Google and Firebase writes form one atomic transaction. Reuse its household/order context and catalog where mapping is valid. Add authenticated server actions for claims, line completion, staging, and delivery; the existing two packed flags are too coarse to represent these operations.

Use atomic updates for competing claims and version checks for stale changes. Make repeated taps and retries safe through operation identifiers. Firestore transactions provide atomic reads and writes and retry on concurrent changes, which makes them a suitable mechanism for these proposed controls. [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

Keep the import adapter separate from fulfillment logic, allowing Google intake to be replaced later without changing the volunteer workflow. Use the existing backend stack unless implementation discovery identifies a concrete blocker. No new database platform is needed solely for this feature.

A responsive web app serves the initial workflow; add a manifest and home-screen installation after the core flow is reliable. Installation support and behavior vary across browsers and operating systems, so validate on the actual iPads and phones. [MDN web app installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)

All working screens need bounded automatic refresh with a visible last-success time; the existing admin screen’s one-time loads are not sufficient for a live packing queue. Proposed pilot target: refresh within five seconds while a working screen is open and mark it stale after fifteen seconds without a successful refresh. Server-side claims and readiness checks remain authoritative regardless of screen freshness. Validate the target on site rather than promising it from local tests.

The first version requires connectivity for shared writes. Show last confirmed sync and disable all operational writes when disconnected. Do not present queued local actions as shared truth. A PWA does not by itself solve simultaneous offline work.

Prepare an event-specific paper fallback with order IDs, current package locations, and a generated-at timestamp. If connectivity fails, the coordinator explicitly switches affected work to paper, assigns ownership, and records handoffs. Before returning to digital work, reconcile those changes and prevent stale devices from overwriting them. Test this drill before relying on the system during distribution.

Staff access should distinguish coordinators, pickers/packers, greeters, and runners. Show only information needed for the role; public progress displays should use order codes rather than names or contact information. QR codes identify records but do not grant access. Shared devices need accountable operator selection, revocable access, logout, and cache cleanup. Set retention and export rules with the organization before live use; exclude client data from application logs and demo fixtures.

## Equipment and physical setup

Start with an existing phone or tablet per active picker or picking cart, a coordinator screen, a shared staging device if needed, and devices for greeters/runners. A cart-mounted device may be easier than carrying a tablet while handling food. Provide charging, protective cases, and a cleaning routine.

Use large printed location signs and recognizable cart/tote codes. Test Wi-Fi along the actual shelf route, at cold storage, and beside cars. Device count should follow simultaneous roles, not household count.

Reuse the label pilot’s hardware work where practical, but retain its outstanding printer and connection validation. A successful iPad print inside the church’s existing software does not prove this app can use that integration. Provide handwritten identity labels and ordinary-paper output as fallback; do not make picking dependent on a working label printer.

## Delivery phases and acceptance

**Phase 0 — confirm operations and map data.** Observe a session, map shelves and staging, inspect the complete authorized response schema, define allocation and substitution rules, and test connectivity. Use fictional examples to walk through dry-only, cold, specialty, shortage, and duplicate cases. Select the production owner and support contact.

**Phase 1 — digital dry picking and staging pilot.** Implement reviewed import, preparation-stage mapping, dry-portion claims, shelf-ordered line outcomes, exceptions, package counts, exact locations, audit history, and fallback export. Keep the current arrival-triggered perishable process in place during this pilot. Pilot an explicitly assigned subset of orders with a few volunteers. Keep paper as backup for those orders, not as a second independently worked queue.

**Phase 2 — connected pickup and perishable packing.** Connect existing check-in and walk-ups to the shared order record. Add the arrival gate, perishable queue and claims, parallel dry retrieval, complete/partial package handoff, cancellations, and event closeout. Use one authoritative arrival flow while preserving the pickup interface. Test physical labels and optional QR retrieval. This phase completes the proposed end-to-end workflow.

**Phase 3 — optimize based on measured delays.** Consider zone picking, multi-order carts, standard-box templates, shortage alerts, optional client notifications, and fuller stock tracking. Do not treat quantities requested or marked picked as an accurate perpetual inventory without receiving, counting, and adjustment workflows.

Required acceptance scenarios:

1. Importing the same event twice produces no duplicate orders; duplicate source IDs remain held for review.
2. A source header change or unmapped selection is visible and does not silently omit food.
3. Two volunteers claiming the same portion result in one owner; dry retrieval and perishable packing can have different owners. Reassignment preserves completed items and physical-cart accountability.
4. Partial fulfillment and substitutions preserve intended and actual quantities; unresolved exceptions block readiness.
5. Two dry boxes are staged before arrival; produce, chilled, and frozen packages are created through packing after check-in and remain linked to that same order.
6. An item change after packing triggers review and invalidates affected readiness without deleting prior work.
7. Check-in releases exactly one perishable task, preserves dry completion and locations, and carries the existing Blue/Orange line and pickup number. Repeated taps, integration retries, and label reprints create no duplicate packing or runner tasks.
8. Missing a cold package prevents complete delivery; an approved partial handoff remains incomplete and lists what is owed.
9. Cancellation and no-show processing retain package occupancy until physical disposition is recorded.
10. Printer failure allows manual labels; internet failure follows the paper drill and reconciles without duplicate fulfillment.
11. A picker cannot change event rules or view unnecessary contact data; unauthenticated QR access reveals no household information.
12. A new volunteer can finish a representative portion after a short orientation and resume it correctly after interruption.
13. Before check-in, perishable requests are visible for planning but cannot be claimed or marked picked/packed, including through direct server requests. Produce follows this rule regardless of storage temperature.
14. Fully staged dry goods with unreleased perishables show successful advance preparation, not an exception. A dry-only order skips perishable work after arrival.
15. A never-arrived household creates no perishable packing task or perishable restock quantities.
16. An integration or printer failure preserves arrival, surfaces the specific failure, and recovers without releasing duplicate work. Check-in without printing and recovered interrupted check-ins also release work. Advance printing and reprints do not.
17. Legacy packed checkboxes and direct writes cannot bypass claims, arrival gating, package counts, or verification for managed events.
18. Removing a source order with dry boxes already staged preserves that work and creates a review item.
19. A stored but ungathered package prevents Ready for handoff. Zero packages delivered can never report complete delivery.
20. A corrected line/number reaches packers and runners without another task; delayed revisions cannot overwrite newer car details.
21. Cancellation or departure races reject stale packing/handoff writes; delayed arrival messages cannot reopen work.
22. An empty dry portion, a dry-only order, a standard-box walk-up, and free-text baby/special requests all have explicit, non-fabricated outcomes.
23. Partial handoff or restock is blocked when the package-to-item allocation needed to describe it is missing.

## Measuring whether it helps

Record a baseline during one representative event, then compare pilot results using order size and volunteer experience as context. Measure advance dry picking and staging separately from arrival-to-perishable-start, perishable packing, dry retrieval, final assembly, and arrival-to-handoff time. Also track pauses, missing-package incidents, corrections, and paper use. Report both typical and long waits; averages alone can hide a few badly delayed households.

Calculate advance dry staffing and pickup-time perishable staffing separately; the latter must account for peak car arrivals, not only the event average. For each stage, calculate staffing from observed work: **orders × average active minutes per order ÷ available minutes per volunteer** gives the theoretical picker count, before allowing for breaks, replenishment, exceptions, and uneven arrivals. For illustration only, 120 orders taking 10 active minutes each require 20 picker-hours, or five people over four hours before those allowances. Measure actual values before scheduling around this example.

Choose the next investment from the bottleneck: reorder the shelf route if walking dominates; improve locations if retrieval dominates; add a cold-zone volunteer if final assembly dominates. Avoid promising a percentage time saving before the pilot.

## Site configuration to settle before a live pilot

- Map each requested item into the confirmed advance-dry or after-arrival-perishable stage, independently of storage temperature; who maintains that mapping when the catalog changes?
- Does the full Google response record category choices or quantities, and who defines the allocation for each event?
- How many volunteers work simultaneously, how many packages does an order typically create, and where do they fit?
- Which dietary and substitution decisions require a coordinator, and what is the rule for partial delivery?
- Who can correct source IDs, resolve duplicate submissions, and approve changed orders after picking begins?
- Which devices, network coverage, and printer route pass an on-site trial?
- Who owns training, access removal, support, reconciliation, and recurring software costs?

Development can begin with fictional fixtures and the implementation plan. Live import and release remain gated on these operational and data-mapping checks; estimate the remaining integration work after those checks. The major effort is dependable import, concurrent volunteer work, exception handling, and pickup reconciliation; drawing a digital checklist is only one part of the job.
