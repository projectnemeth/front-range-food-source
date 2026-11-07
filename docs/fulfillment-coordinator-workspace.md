# Phase Two coordinator setup and reviewed imports

The local coordinator screen is `/staff/fulfillment/coordinator`, linked from the dry-packing workspace. It uses the same server feature flag, which defaults off. The new screen and API do not call Google, write the original response sheet, or connect to the check-in pilot.

## Set up a separate event

An existing application administrator can create a new Phase Two event. The server verifies the administrator profile in the creation transaction and assigns that person the event coordinator grant. The event starts disabled and closed. Creating a fulfillment event does not create, close, reopen, or modify a customer-order batch or Apps Script pickup event.

Enter an event ID, descriptive name, pickup date, source scope, and reviewed mapping version. The source scope represents the exact spreadsheet/tab namespace, such as `example-sheet/tab`. Each imported source key must start with that scope plus `/`, followed by a stable reviewed registration identity. This is a namespace check, not proof that the records were read from Google. Date, source scope, and mapping version are immutable through this first setup screen; create another event rather than silently repurposing one.

The coordinator can then:

- Add or update staging positions and their package capacity. Positions holding goods cannot be disabled or reduced below their occupied count. Occupancy and order ownership are preserved.
- Grant or revoke packer/runner access for an existing, enabled Firebase account. The screen takes a staff UID; it does not create accounts or alter client profiles. Coordinator access cannot be replaced or revoked by these staff controls. Additional coordinator provisioning remains a privileged administrative task.
- Explicitly enable or pause dry packing for the event. Enabling requires at least one active staging position. Every change checks setup version and records an operation receipt and audit entry; stale sessions cannot overwrite newer setup.

Event coordinators may access setup while packing is disabled. Packers and runners cannot access setup or import records. The existing check-in pilot has no knowledge of these new events.

## Preview and apply mapped records

This milestone accepts a JSON array of already mapped order manifests. It is **not a live Google Sheet adapter or a raw CSV importer**. Complete food-column mapping, approved allocations, duplicate-response review, and source provenance still need to be established before preparing real records. See the entirely fictional [example input](fulfillment-import-example.json).

Each record must explicitly include event and source references, source revision, mapping version, original requests, household label, notes, dietary information, quantities and units, preparation stages, storage classes, and shelf positions. Do not invent quantities or discard free-text, dietary, or baby-supply requests to make an input pass validation. Source keys must be stable reviewed registration identities, not row numbers or assumed-unique Food Bank IDs. Duplicate keys within one preview block both records.

Submit at most ten records at a time, within the existing 20 KB request-body limit. Split larger input into separate reviewed batches. This is an incremental import; omission of a household never means cancellation or deletion.

Preview persists a server-owned, immutable draft with three possible row results:

| Result | Meaning |
| --- | --- |
| New | No order or source reservation exists; applying will create an order |
| Unchanged | The source maps to the identical saved manifest; applying preserves all work |
| Blocked | Duplicate identity, wrong event/scope/mapping, conflicting reservation, or changed existing manifest requires separate review |

The server assigns stable fulfillment IDs using event and source identity; the submitted `id` is a placeholder, not an instruction to overwrite a document. The preview shows the assigned ID and every mapped item, quantity, stage, note, and dietary instruction for review.

Applying requires explicit confirmation and sends only the saved draft ID. The server does not accept replacement manifests in the apply request. Drafts expire after 30 minutes. Setup changes or conflicting source/order writes invalidate an unapplied preview. All rows are checked before any order is created, and blocked rows prevent the entire batch from applying. A successful apply atomically creates orders, source reservations, audit entries, and the draft's applied receipt. Repeating the same apply returns the prior result without duplication.

Existing claims, package locations, arrival state, and handoffs are never overwritten by this import flow. Unchanged records can be reimported even if operational work progressed after preview.

## Changed sources and remaining limits

A changed existing manifest is blocked and displayed with its submitted details. Preview does not place that existing order on hold or claim the uploaded revision is authoritative. It cannot infer whether an uploaded file is a correct new source revision or a mistaken mapping. Reconciliation and an explicit hold/update workflow are still required before this can serve as ongoing live source synchronization. Until then, pause affected event work and resolve changes with the coordinator; do not treat a blocked preview as an applied update.

The screen does not fetch Google responses, validate all source columns against the real form, automatically resolve duplicate households, detect source deletions, create staff accounts, or migrate active pickup work. Saved drafts contain household information and remain server-only; draft expiry prevents applying them but does not delete them. Retention/cleanup and operational ownership must be configured before using real client data.

## Rehearsal and verification

Use only the demo Firebase emulator project for the committed fictional fixtures. The browser rehearsal creates a disabled event, adds a position, previews without creating orders, applies once, blocks a changed record, and explicitly enables the event before the dry picker can claim it. Server tests additionally cover conflicting setup edits, revoked access, occupied positions, atomic apply retries, duplicate sources, expired/stale drafts, and cross-event authorization.

The CI browser step opts into Phase Two only in its emulator process, so these new tests are exercised rather than skipped. Production and local runtime configuration remain unchanged. A live pilot still requires reviewed real-source mapping, staff/account setup, deployment-baseline checks, and the operational rehearsal described in the implementation plan.
