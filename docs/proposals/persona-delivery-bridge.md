# Approved persona scheduling bridge: dormant local proposal

This candidate does not activate publishing, run a migration, create a provider connection, grant approval, upload/share media, or change any live plan. No runtime route, cron, environment flag, or worker imports these modules. `CHARACTER_PROMO_DELIVERY_ENABLED` is false; the dependency-injected engine defaults to disabled. A future caller cannot safely be enabled until all requirements below are completed.

## Implemented locally

- `character-promo-delivery.ts`: preparation of an exact review snapshot, freshness and all eight current-video QA gates, actual byte hashing, live rights/canon identity, script and explicit final approval gates, strict verified destination routing, snapshot-bound explicit delivery approval, one-shot claim/finish orchestration and truthful scheduling receipts.
- `character-promo-approval.ts`: dormant confirmation adapter. It freshly authenticates an admin, ignores request-supplied actor data, re-reads trusted sources and compares the review digest before invoking the service-only approval RPC. It cannot grant missing final voice/video/publication approvals.
- `character-promo-store.ts`: concrete RPC adapter for the offline ledger proposal. Errors or malformed claim results never permit a provider call. No direct-table fallback.
- `character-promo-metricool.ts`: dormant provider adapter. It verifies the sole matching brand mapping, checks duplicates, verifies private source bytes before opening a fresh MCP session, scopes a signed URL to the exact approved private object, and creates only the approved single-network post once. It requires create-returned provider ID/UUID and matching readback, then verifies rehosted media bytes. Rehosting/transcoding without identical bytes remains unknown and requires manual review, not an automatic retry.
- `character-promo-delivery.test.cjs`: mocked gate, stale-data, race, ambiguous-write, actor, receipt identity, media and session-clock tests. Mock concurrency demonstrates engine semantics only, not PostgreSQL isolation. Separate SQL fixtures must prove the actual database guarantees.

## Scope and deliberate limits

Only Keith routed through `truskoolcorp_metricool_brand_5373515`, with draft mapping `metricool-brand:5373515`, may use this integration. Brand 5373515 / user 4174093 must currently map Facebook 146219355471397 and Threads truskoolcorp. Each plan and approval names one of those exact accounts. There is no Café-brand, Instagram, or other-persona mapping; no fallback.

This version schedules once per existing plan. A durable claim never expires, is never reclaimed, and survives approval revocation or retry attempts. Combined with legacy unique(promo_id,network), this intentionally does not implement recurring publishing, rescheduling, or reuse of a promo on the same network. Uncertain attempts require provider reconciliation; do not create a new plan/approval to bypass them.

No derivative is made. Exact finalized MP4 bytes are reused, preserving framing. A derivative would need a separately approved export hash and explicit source lineage, using fit-and-pad rather than crop. The existing website variant pipeline is unchanged.

Media download precedes opening the existing MCP session with its 25-second absolute deadline. Subsequent slow provider/CDN operations may still exceed that deadline: any uncertain outcome remains consumed/unknown. Never refresh authentication and repeat create after timeout. The existing schema/tool behavior of create-returned ID/UUID and identical-byte media rehosting must be verified with a read-only or isolated-provider contract fixture before activation; no missing identity is inferred from caption matching.

## Activation blockers and required decisions

1. Independently review and run the offline SQL proposal and real PostgreSQL fixtures, including simultaneous claims, source mutation versus claim, privilege boundaries, approval revocation, and interrupted receipts. It must remain outside auto-applied migration paths until separately authorized.
2. Approve the production schema/security rollout and populate the narrow authorized-owner allowlist, if required by that proposal. No owner ID is inferred or seeded in this task. Service-role access is never exposed to the browser.
3. Implement the missing explicit content review transitions/UI for final voice, video QA, and publication approval, with current canonical references and all eight observations. Current null approval stamps are not filled by this bridge. Preparation currently rejects missing final content approval; it is an execution-ready review candidate, not a replacement for that content workflow.
4. Implement a trusted source reader that loads draft/plan/all QA/private bytes and fresh GLYPH/Metricool identity. Canon hashes and voice identity must come from current authoritative GLYPH data, not a historical snapshot. The required revision_sha256 must hash the full current canonical context/persona rules and relevant rights/identity evidence, not merely asset IDs or approval status. Its derivation is an activation-blocking trusted-reader responsibility; no revision is invented here. Live freshness is checked within 60 seconds; remote rights cannot be atomically locked by PostgreSQL, so changes during a claim require a documented reconciliation policy.
5. Implement the owner confirmation UI and same-origin/CSRF-protected route showing the exact caption, date/time/timezone, network/account, video, canonical references and final approval details. Its POST contains only plan ID and reviewed digest. It calls the dormant approval adapter, not a body-supplied snapshot or actor.
6. Wire the bounded, redirect-rejecting CDN byte reader and a fresh authorized Metricool session factory. Ensure tool schema and media upload capability can preserve the approved source/hash. Private URL transmission occurs only after valid approval and durable claim.
7. Add a deliberate dispatch entry point only after explicit activation authorization. Do not piggyback on website dispatch or add a cron as part of this proposal. Run one separately authorized delivery and verify scheduling; publication requires separate provider-issued evidence.

A successful receipt here means **scheduled, not published**. There is no publication-status reconciler in this first version. There were no external provider calls during implementation or testing.
