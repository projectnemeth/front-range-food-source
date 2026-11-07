# Phase Two dry packing workspace

The new route is `/staff/fulfillment`. It is disabled unless the server environment contains `FULFILLMENT_PHASE_TWO_ENABLED=true`. The default is disabled. No link was added to the customer app or pickup-label pilot.

Enabling the server flag alone does not release an event. Every request also requires a verified Firebase Auth ID token, an enabled/open `fulfillmentEvents` record, and an active event staff grant with role `packer` or `coordinator`. Staff accounts do not need a food-client profile. No role, grant, event, or source configuration is created automatically by this screen.

## Implemented flow

1. Sign in using a provisioned staff account and enter the event ID supplied by the coordinator.
2. Select an order. The list is paginated in groups of 50 with First page and Next page controls.
3. Claim its dry portion. Another volunteer cannot claim or edit the same active portion.
4. Pick items in shelf order. Record full quantities with one tap or enter a shortage/substitution and reason. A coordinator can approve exceptions on the same screen.
5. Verify dietary instructions and contents, choose a package count and staging position, apply event/order/package identifiers, and confirm packing. This first screen places the portion's packages at one position; splitting a portion across positions will require a later UI extension.

The UI only offers advance-dry actions. The HTTP boundary also rejects perishable commands, arrival, retrieval, handoff, and control changes. Perishables remain in the existing check-in workflow. This is an isolated dry-preparation screen, not the future connected pickup system.

Queue responses omit notes, original source keys, and item contents; selecting an order returns the dry checklist and relevant notes/dietary information. Perishable requests are shown as a count, not an actionable checklist. Runner grants cannot access this preparation screen.

## Synchronization and recovery

The open workspace refreshes every five seconds and on focus. It marks data stale after fifteen seconds without a successful read and disables changes when stale or offline. Any read failure immediately pauses writes. Server transactions independently check the current order version, ownership, event, and grant.

A failed or lost save response retains the operation token and payload in the open tab. Retry same save resubmits that exact request, allowing the server receipt to confirm the original result without a second action. Changing events, choosing another order, and signing out are disabled while a save outcome is unknown. Closing/reloading the tab warns the operator; pending tokens are not persisted across browser restarts. After an intentional restart, inspect the server's current order state before continuing.

Permission or event closure removes displayed order data on the next read. Conflict responses refresh the checklist for review. No operational browser writes are queued offline.

## Development verification

Use only the existing `demo-food-source` emulator configuration for automated fixtures. The new API tests exercise the feature gate, verified tokens, accountless staff, forbidden roles, revoked grants, strict payloads, dry-only commands, and pagination beyond 50 orders.

To run the opt-in browser tests with local Auth and Firestore emulators already running:

```sh
FULFILLMENT_PHASE_TWO_ENABLED=true node scripts/test-env.mjs ./node_modules/.bin/playwright test
```

Playwright starts the temporary Next.js development server through the existing wrapper. The suite seeds fictional staff/order/location records only after asserting the demo project and local emulator address. It covers the dry-packing flow, a lost response after a committed save, a competing claim, offline/revoked access, and a mobile-width overflow check. The existing browser tests still run; without the feature flag the new browser cases are skipped.

Tests do not establish live Google mapping, physical label fit, network coverage, or production deployment readiness. Staff provisioning, source import/reconciliation, cross-stage integration, and the coordinated live-pilot release remain separate milestones. Current Apps Script pilot files and deployed settings are unchanged.
