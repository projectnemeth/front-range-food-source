# Coordinator-reviewed reconciliation

Updated November 19, 2026, as disabled-by-default Phase Two development. No production deployment, Google writes, check-in bridge, label or printer changes are included.

## Operating procedure

1. In the coordinator workspace, load the order ID and record why instructions or allocations changed. Starting review holds the order immediately. Notify its volunteers to stop and keep goods identifiable; software cannot stop physical work already underway.
2. Review the household name, source revision, dietary instructions, requests and quantities. Existing allocated items retain their source quantity; amend their packing allocation separately, with a reason and a reviewed total event stock budget. Use **Add new item selection** for genuinely new items: enter the request, item, household quantity, unit, shelf, food category and review reason, then confirm stock and preparation timing.
3. Preview the changes. The preview expires after 30 minutes. Changes to the order, event configuration or affected allocation budgets require a fresh preview.
4. Account for every staged package: unpack and retain for repacking, return to stock, or discard, with a note. Account for loose picked goods too. Clear the order's physical staging positions and notify volunteers before confirming apply.
5. Apply atomically archives the previous work, records dispositions, frees staging occupancy, updates allocations and restarts every portion for repacking. Dry work is queued immediately; perishables remain waiting unless an actual check-in already exists. Check-in identity and time are preserved.

Cancel a review only if goods, contents and staging positions have not changed. Cancellation restores prior control and work, retaining any check-in received during review. If goods have moved, finish reconciliation instead of claiming they are unchanged.

## Boundaries

This is a full-order repack, not a partial box edit. Existing package IDs and picked outcomes remain in audit history, not in the restarted order. Gathered, handed-over, delivered, cancelled or departed orders are rejected and need a separate return/correction workflow.

This slice supports changes to existing lines and approved allocations, plus reviewed new item selections. Existing selections can be removed through explicit review; retained lines cannot be remapped to a different item, unit, preparation stage or storage class. Source imports still reject changes to orders with work; reconciliation is a separate explicit coordinator action, not an automatic source refresh.

Stock values are reviewed allocation budgets, not measured on-hand inventory. The proposed event total equals its current allocated total minus this order's previous share plus its revised share. It must fit the reviewed available budget. Package disposition never automatically increases stock. Original approved plans remain historical records; allocation summaries and per-order overrides record reconciliation references. A stock reduction below all other outstanding shares requires further coordinated reductions; there is no multi-order reconciliation transaction yet.

## Safeguards and evidence

All operations verify active event coordinator access inside a Firestore transaction, including while packing is paused. Pending reconciliation blocks ordinary packing, gathering and control commands; arrival may still be recorded without releasing the hold. Immutable previews bind the current order and allocation budget versions. Apply validates every package and exact staging occupancy before any write. Retries cannot apply twice or reuse an operation ID for different changes.

Audit records retain the original order, the immediately preceding order, reasons, coordinator identity, timestamps, revised manifest, allocation adjustments, package dispositions and loose-goods instructions. Open reviews appear in the coordinator workspace and the dry workspace displays a stop-packing notice.

Automated coverage includes held work, arrival timing, full repack, allocation preservation, budget overrun and stale budgets, package completeness, occupancy conflicts, cancel restoration, expiry, revoked permissions, custody and terminal rejection, plus the browser review/apply flow. The existing registration/printing regression suite remains included.

## Adding new item selections

The saved preview identifies each new selection, its reviewed category, quantity, shelf and reason. Shelf-stable selections enter advance dry work. Produce, refrigerated, frozen and other perishable selections enter after-arrival work; produce remains after-arrival even though its storage is ambient. The server validates this relationship, not just the screen. Adding the first perishable line creates a waiting portion, or a queued portion if check-in already exists, only on apply.

Each added line needs exactly one explicit review and a unique line ID. An item already present on the order must be edited on its existing line. Case, whitespace and Unicode-normalization differences do not allow duplicate items or bypass an existing budget. Coordinators must still verify real item identity; the software cannot recognize every alias or equivalent package size.

For an item with a released allocation budget, enter the revised total event stock. Its unit must match the budget; the added share increases the event allocated total atomically and receives its own audited allocation record, which later reconciliation can adjust. Existing household bindings are reused; for an order without allocations, its stable source key becomes its household binding. A binding already assigned to another order blocks apply. Original approved plan snapshots remain unchanged. Unreleased or ambiguous matching budgets must be resolved before adding the selection; this flow does not partially release an approved plan.

For an item with no allocation budget, the reviewed line quantity becomes its packing quantity. The coordinator confirms household size and physical availability; this does not create an inventory reservation or a new proportional allocation plan. If a matching budget appears between preview and apply, apply rejects the stale review. Budget version changes and competing household additions also require a new preview rather than silently overspending stock.

All new selections remain proposed until apply. Cancel leaves the original manifest and budgets intact. Apply includes new selections in the same full-order repack, package-disposition and staging-clearance transaction as other reconciliation changes. Removing a proposed selection from the form invalidates its preview; saved selections use the separate removal review below.

## Removing saved item selections

Select **Remove selection** on each unwanted item. Enter a reason, returned and discarded quantities, and a goods note. Counts must account for at least the recorded picked quantity, including any unrecorded loose goods. Review the physical goods before previewing; if the actual disposition changes, update the review and generate a new preview before applying. Each omitted line requires exactly one removal review. Remaining items retain their identity, unit, timing and storage classification. Removing and re-adding the same item in one review cannot bypass those protections.

For allocated items, enter **Reviewed stock before disposal** in the allocation's units. The server computes:

- New allocated total = previous allocated total − this order's approved share.
- New available total = reviewed stock before disposal − discarded original-item units.
- The remaining allocated total must fit the new available total.

Returned goods do not increase the available total: that total already includes the allocation being released. For example, an event with 12 units allocated, including this household's four, releases those four on removal. If three are returned and one discarded, a reviewed total of 12 becomes 11 available and eight allocated. This avoids double-counting returns or offering discarded goods to another household. The immutable preview captures the budget version; concurrent budget changes reject apply and require review again.

If a substitute was picked, explicitly count the discarded **original-item** units that affect this budget. Discarding a substitute does not automatically reduce the original item's stock. The substitute name, overall returned/discarded counts and budget-specific discard count remain in the audit. Reconcile the substitute's physical stock separately. Items without an allocation budget also retain return/discard history but require manual physical-stock updates; no inventory credit is inferred.

Removal is part of the existing full-order repack. Every staged package still needs a disposition, loose goods must be accounted for, and staging positions must be cleared before apply. The single transaction removes selected lines and their allocation entries, updates affected budgets, resets the remaining work, releases positions, and records the previous order, original requests, allocations, picked quantities, substitutions, goods counts, reasons, coordinator and timestamps. Retries cannot release the same allocation twice. Cancelling an untouched review changes no selections or budgets.

Removing the final selection leaves an empty order **on hold**, with both portions not required and no delivery recorded. It cannot be reopened through an ordinary resume command or handed off. A new coordinator review may add selections again. Its original household allocation binding and check-in are preserved, and source imports cannot silently restore removed items. Initial source imports still require at least one selection. Gathered, delivered or otherwise terminal orders remain outside reconciliation.
