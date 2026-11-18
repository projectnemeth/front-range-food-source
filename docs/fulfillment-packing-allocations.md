# Apply approved allocations to packing quantities

Implemented locally November 18, 2026, behind the existing disabled-by-default Phase Two gate. No label-pilot source, Google resource, deployed setting or Firebase rule is changed.

## Coordinator workflow

1. Import reviewed source manifests using the existing coordinator preview/apply flow. Original requests, items, units, shelves, storage and preparation stages must already be mapped.
2. Approve an allocation plan using household sizes and available stock. Approval alone still does not affect packing.
3. Open the approved plan from **Current approved plans** and use **Load packing orders**. Link every household to its existing order and the matching item line. The screen offers matching household labels, items and units; the coordinator must verify durable registration identity, not rely on names alone.
4. Select **Review packing quantities**. Review each original request, previous quantity, approved quantity, unit, shelf and preparation stage. Zero quantities are explicitly shown. The preview is saved server-side and expires after 30 minutes.
5. Confirm the links and select **Apply approved packing quantities**. Every household in the approved plan is applied together, or none are changed.

The current linking screen supports events with up to 200 existing orders and plans with up to 100 households, within the existing request limit. A plan requires exactly one distinct order per household and one uniquely matching item/unit line in each order. Duplicate matching item lines require source reconciliation. Household labels must match the approved snapshot, but labels alone do not establish identity; reviewed links are recorded as event-scoped household-to-order bindings. Further item plans must use those same bindings. An order cannot receive allocations under different household keys.

## What changes in the packing order

The manifest and original requested quantities remain unchanged. A separate `allocations` entry on the order records the approved plan ID, item key, household key, target quantity, approving coordinator, applying coordinator and timestamp. The order version increments; an audit entry records the old quantity and original request. Stable order IDs, source references, notes, dietary instructions, shelves, preparation timing and storage classes remain intact.

The dry checklist displays the effective allocated quantity, plan reference and quantity before allocation. Picker commands and packing validation enforce the allocated target, including when it is larger than the initial mapped quantity. Subsequent shortages or substitutions still require their normal review.

Zero allocations retain the requested item and display **No stock allocated** with an explicit zero-confirmation action. They cannot be picked at a positive quantity or silently omitted. A portion with no supplied items produces no package; an entirely unserved order cannot be marked delivered. The original request and allocation decision remain auditable.

Perishable lines retain `afterArrival`. Allocating produce, chilled or frozen items does not release them for picking, create an arrival, or affect priority. The perishable staff screen and arrival bridge remain separate unfinished work.

## Race protection and restrictions

Only active event coordinators can preview/apply. Planning and linking may occur while the separate Phase Two event is paused. Each apply rechecks role, event configuration, the latest approved item-plan revision, saved order fingerprints and household bindings inside one transaction. A competing claim, source edit, hold, arrival, packed box or completed delivery blocks the entire batch. An unchanged retry returns the saved result without applying twice; operation-ID reuse with altered preview input is rejected.

Orders must be completely unstarted, including no resolutions. Multiple distinct item plans may be applied to the same unstarted order before picking begins. A line cannot receive a second allocation. Once an item plan is applied, new approval/release for that item is blocked until a future explicit reconciliation workflow exists. Approval of a replacement plan alone cannot silently alter quantities already released to picking.

Changed-source imports also block orders with applied allocations, even if picking has not begun, so an import cannot discard the allocation record. Identical source reimports preserve it. This is conservative protection until allocation/source reconciliation is implemented.

This does not reserve or decrement inventory, infer source choices, create orders automatically, reconcile work in progress, or synchronize Google. Coordinators continue to manage physical stock and approve item identities/units. No plan can be released twice under this workflow, but the system does not detect the same physical stock entered under different item keys.

## Verification

Domain tests check effective packing limits, unchanged original requests, preserved perishable gating, explicit zero confirmation and no empty delivery. Emulator cases cover atomic apply/retries, full-household linking, identity/unit mismatches, duplicate lines, persistent household bindings across items, stale plans/orders, expiry/revocation, source reimports and rollback when work starts. The browser rehearsal follows approved plan → linked order preview → applied targets → actual dry picking.
