# Coordinator-reviewed reconciliation

Implemented November 18, 2026, as disabled-by-default Phase Two development. No production deployment, Google writes, check-in bridge, label or printer changes are included.

## Operating procedure

1. In the coordinator workspace, load the order ID and record why instructions or allocations changed. Starting review holds the order immediately. Notify its volunteers to stop and keep goods identifiable; software cannot stop physical work already underway.
2. Review the household name, source revision, dietary instructions, requests and quantities. Existing allocated items retain their source quantity; amend their packing allocation separately, with a reason and a reviewed total event stock budget.
3. Preview the changes. The preview expires after 30 minutes. Changes to the order, event configuration or affected allocation budgets require a fresh preview.
4. Account for every staged package: unpack and retain for repacking, return to stock, or discard, with a note. Account for loose picked goods too. Clear the order's physical staging positions and notify volunteers before confirming apply.
5. Apply atomically archives the previous work, records dispositions, frees staging occupancy, updates allocations and restarts every portion for repacking. Dry work is queued immediately; perishables remain waiting unless an actual check-in already exists. Check-in identity and time are preserved.

Cancel a review only if goods, contents and staging positions have not changed. Cancellation restores prior control and work, retaining any check-in received during review. If goods have moved, finish reconciliation instead of claiming they are unchanged.

## Boundaries

This is a full-order repack, not a partial box edit. Existing package IDs and picked outcomes remain in audit history, not in the restarted order. Gathered, handed-over, delivered, cancelled or departed orders are rejected and need a separate return/correction workflow.

This slice supports changes to existing lines and approved allocations. It does not add/remove lines or change item identity, units, preparation stages or storage classifications. New item selections and remapping remain future work. Source imports still reject changes to orders with work; reconciliation is a separate explicit coordinator action, not an automatic source refresh.

Stock values are reviewed allocation budgets, not measured on-hand inventory. The proposed event total equals its current allocated total minus this order's previous share plus its revised share. It must fit the reviewed available budget. Package disposition never automatically increases stock. Original approved plans remain historical records; allocation summaries and per-order overrides record reconciliation references. A stock reduction below all other outstanding shares requires further coordinated reductions; there is no multi-order reconciliation transaction yet.

## Safeguards and evidence

All operations verify active event coordinator access inside a Firestore transaction, including while packing is paused. Pending reconciliation blocks ordinary packing, gathering and control commands; arrival may still be recorded without releasing the hold. Immutable previews bind the current order and allocation budget versions. Apply validates every package and exact staging occupancy before any write. Retries cannot apply twice or reuse an operation ID for different changes.

Audit records retain the original order, the immediately preceding order, reasons, coordinator identity, timestamps, revised manifest, allocation adjustments, package dispositions and loose-goods instructions. Open reviews appear in the coordinator workspace and the dry workspace displays a stop-packing notice.

Automated coverage includes held work, arrival timing, full repack, allocation preservation, budget overrun and stale budgets, package completeness, occupancy conflicts, cancel restoration, expiry, revoked permissions, custody and terminal rejection, plus the browser review/apply flow. The existing registration/printing regression suite remains included.
