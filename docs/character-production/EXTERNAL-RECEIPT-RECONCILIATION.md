# Existing external promotions: reconciliation boundary

Eight owner-selected clips were scheduled outside this application's dispatch ledger.
They must not be represented as application approvals, app claim attempts or public
post receipts. Provider PENDING is scheduled, not published. Existing blocked Tru Skool
Facebook/Threads plans must not be overwritten with Café Facebook/Instagram receipts.

The pure `externalPromoDeliveryDecision` is negative-only: a trusted registry suppresses
same SHA256/brand/network/account, even for copied drafts, changed schedules and unknown
provider outcomes. Missing/malformed registry holds delivery; records never expire into
an automatic retry. It grants no approval and issues no writes.

Before live integration:
1. Read exact Café Metricool brand and connected FB/IG IDs (not CDN path inference).
2. Preserve provider readback, exact uploaded-byte hash and promo ID linkage in a
   restricted durable registry. Do not expose signed private media URLs in evidence.
3. Add this check atomically to the app's DB claim path and recheck before provider
   submission. An in-memory or request-supplied registry is not sufficient.
4. Lock destination+hash consistently with externally managed scheduling, or explicitly
   freeze external writers during the cutover; a check alone cannot close that race.
5. Reconcile successful public destination URLs separately after publication.

No SQL migration, external schedule mutation or approval mutation is included.
App dispatch remains disabled. Its current destination allowlist supports only old
Tru Skool FB/Threads, not Café. The fixed guard below is preventative wiring, not
evidence of a live Café dispatch route or full recurring scheduling integration.

## Fixed verified cohort guard

`character-promo-known-external.ts` now records the eight verified byte hashes and
16 exact destinations from Nov14 Metricool readback (Café brand7605217, Facebook
105363501666032, Instagram handle cafesativainc). It includes no private URLs.
The existing explicit dispatch runtime checks this immutable server-side registry
before opening a provider session and again before an external write. This guard
only prevents duplicates of that verified cohort; it does not authorize delivery,
change approval/plan rows, enable dispatch or assert publication. Because this fixed
registry is bundled code rather than mutable client input, the check cannot race
an in-process registry deletion. Future external schedules still require the durable
registry/atomic-claim integration described above. Reposts of these same bytes require
explicit reviewed reconciliation; they never become eligible by waiting.
