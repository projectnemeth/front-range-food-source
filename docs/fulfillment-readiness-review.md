# Fulfillment readiness review

Reviewed November 6, 2026 against local source. Verdict: ready to begin staged implementation after the planning corrections below; not ready for live deployment. No fulfillment application code was implemented or changed by this review.

## Findings and dispositions

| Severity | Finding | Planning correction |
| --- | --- | --- |
| High | Only a detailed label-pilot implementation plan existed; fulfillment phases lacked dependency and cutover detail | Added a dedicated fulfillment plan with contracts, ordered milestones, tests, ownership boundaries, and release gates |
| High | Existing admin packed toggles and Firestore permissions could bypass the richer fulfillment workflow | Require server-only workflow writes and deny legacy toggles for managed events; adopt old packed work only after verification |
| High | Existing customer orders require Firebase user identity, while Google imports may have no account | Separate fulfillment orders from client orders, with explicit source/event mappings and optional native order references |
| High | Arrival bridging was underspecified for no-print check-in, interrupted writes, corrections, held orders, and printed labels before acknowledgement | Specify durable reconciliation, stable arrival IDs, authenticated messages, revision ordering, independent print state, and paper-mode coordination |
| High | Complete delivery could be asserted merely by resolving remaining obligations; readiness only required known locations | Require physical gathered custody and actual handoffs; retain reduced/unserved/partial outcomes without fabricating delivery |
| High | Partial delivery claimed precise item quantities while item-to-package mapping was deferred | Require package allocations for partial package actions or restrict action to whole portions |
| Medium | Preparation stage was mixed with storage class; empty dry portions and free-text/baby requests were incomplete | Define two portions independently of storage, explicit empty outcomes, and reviewed mapping for all extra requests |
| Medium | Source removal protection applied only after arrival, losing advance-packed work | Preserve any claimed/packed order with a review hold regardless of arrival |
| Medium | Cancellation, departure, and late messages lacked complete concurrency rules | Recheck state/version on every write; late events cannot reopen work; resume preserves existing records |
| Medium | Current admin uses one-time loads, which cannot serve a live queue | Require bounded refresh, stale indicators, full-event pagination, and authoritative server checks |
| Medium | Car/device authentication and staff authentication were implicitly interchangeable | Preserve Apps Script device access, add event-scoped Firebase staff grants, and authenticate the bridge separately |
| Medium | Changing package totals could invalidate labels; walk-up contents were unspecified | Stable event/package identity and explicit standard-box templates without invented contents |

These are corrected design requirements, not claims that the corresponding application safeguards already exist.

## Evidence inspected

- [Order schema](../src/lib/schemas.ts) and [submission handler](../src/lib/server/orders.ts): account-bound orders, selection arrays, and two packed flags.
- [Admin interface](../src/app/admin/page.tsx), [order loader](../src/lib/admin-orders.ts), and [Firestore rules](../firestore.rules): direct packed updates, paginated one-time reads, and existing privilege limits.
- [Catalog](../src/lib/catalog.ts): current category grouping requires explicit preparation-stage/storage mapping.
- [Pickup actions](../tools/pickup-station/Code.gs) and [device authorization](../tools/pickup-station/Access.gs): separate arrival/print records, check-in-only path, recovery, walk-ups, and device credentials.
- [Source mapping](pickup-labels/source-sheet-mapping.md): identity mapping is documented; complete food mapping is not.
- [Deployment notes](deployment.md): production baseline/cutover validation remains distinct from local implementation.

## Verification and remaining gates

Reviewed the revised state rules, milestones, and acceptance scenarios against the inspected code paths. Checked document links and whitespace. No runtime test suite was run because this change is documentation only; future implementation must satisfy the specified unit, concurrency, integration-failure, browser, and on-site checks.

The remaining live-pilot gates are full source/quantity mapping, event/identity reconciliation, actual deployed-baseline verification, staff and integration access, physical printer/network checks, and a fallback rehearsal. They do not block starting development with fictional fixtures. The earlier label-only effort estimate must not be presented as the estimate for end-to-end fulfillment.
