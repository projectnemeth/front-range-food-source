# Coordinator-reviewed allocation planning

Implemented locally November 18, 2026, behind the existing disabled-by-default Phase Two gate. Open an event in `/staff/fulfillment/coordinator` and use **Allocate available stock**. Only active event coordinators can preview, read or approve plans; planning is available while an event is paused.

## Inputs and proposal

Plan one item using a stable event-specific item key, descriptive item name, explicit unit/package size, total distributable units, and the complete eligible household list. A household entry contains a reviewed stable key, label and positive household size. Only include households requesting that item, after resolving dietary suitability, source identity, duplicate submissions and conflicting household-size fields. The screen provides ordinary fields for each registration reference, name and household size, with add/remove controls. It does not select households from Google automatically.

The coordinator confirms the eligible list and current stock. Available units must exclude reserved or unusable goods. Use consistent units (for example, one one-pound bag, not a mixture of bags and cases). Limits are 100 households per item, 10,000 available whole units, household sizes 1–100, 200 planned items per event, and the existing 20 KB HTTP request limit. Do not split an item's eligible list into multiple plans: subsequent approval replaces that item's plan rather than adding another allocation pool.

The proposal divides available units proportionately by household size:

1. Calculate each household's exact share: available units × household size ÷ total eligible household size.
2. Assign the whole-number part of each share.
3. Distribute remaining units to the largest fractional remainders. Equal remainders use ascending stable household keys, independent of input row order.

The algorithm is a suggested allocation policy, not an assertion that this is the food bank's existing rounding policy. The screen explains it before the coordinator confirms. It makes no minimum, maximum-per-household or automatic dietary substitution assumptions. Example: twelve one-pound rice bags for households of two and four proposes four and eight bags. With insufficient stock, zero allocations are explicitly shown. With zero stock, all quantities are zero. The algorithm conserves the entered stock and proposes distributing all of it; coordinators can reduce allocations to leave units unallocated.

## Review and approval

The preview displays stock, units, total people, each household's size and proposed quantity. Coordinators can change quantities, but every change requires a reason. Approval checks the entire original household set, whole nonnegative quantities, and a total no greater than available stock. The coordinator must explicitly confirm all quantities, including zeros, and recheck stock. Input edits clear the visible preview.

Previews are server-owned snapshots and expire after 30 minutes. Approval uses only the saved snapshot plus reviewed quantities; it cannot silently change stock, units, household sizes or eligibility. Create a new preview if these inputs change. Event setup changes invalidate pending previews. A new approved plan for the same item invalidates competing previews for that item. Retries of the same approval are idempotent; reuse with different quantities fails. Roles are rechecked even on retries.

The creator approves their own preview; other event coordinators can read it. Approved plans remain immutable historical records in `fulfillmentEvents/{eventId}/allocationDrafts`. The `allocationItems/{itemId}` record points to the latest approved plan and version. Event audit entries record the approving coordinator and any superseded plan. The current-plan list can reopen saved details after refresh. Replacing a plan retains its previous snapshot and does not add the prior allocation to the new total.

## Separation from fulfillment and inventory

**Approval saves a planning record only.** It does not reserve or decrement inventory, generate or change manifests, enable an event, claim work, change prepared boxes, or modify source responses. The coordinator must maintain stock availability outside this planner until inventory integration exists. Different item keys are treated as different items; use the same key for revisions and do not enter the same physical stock under multiple keys.

Approved plans can now be applied through a separate [packing-quantity review](fulfillment-packing-allocations.md). It links all households to existing unstarted orders, preserves the original manifest and adds audited packing targets, including explicit zeros. Once applied, replacement approval for that item is blocked pending reconciliation. This does not reserve stock or automatically import source orders.

Perishables remain after check-in. This planner does not set preparation stages or storage classes and cannot bypass arrival gating. Existing dry preparation and perishable timing rules remain in the fulfillment domain. No label-pilot files, Google data, Firebase rules or deployed configuration changed.

## Validation

Unit coverage includes proportional allocation, stock conservation across 101 stock levels, zero/scarce stock, stable tie-breaking, invalid inputs, and reviewed adjustments. Emulator coverage includes concurrent approval retries, audit/history, current-plan replacement, stale stock-plan/configuration detection, expiry, revoked permissions, and no fulfillment-order creation. The coordinator browser rehearsal checks the proposal, a rejected reasonless adjustment, successful approval with an unallocated remainder, and mobile width. Existing registration and printing regressions run alongside it.
