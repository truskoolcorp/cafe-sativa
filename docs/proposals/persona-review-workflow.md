# Explicit persona content review: local dormant workflow

This candidate layers the corrected source reader and a new review workflow over current main 48603814439fbc3bab4e60a01295d89cb1f5cba1. The three PR51 files were copied byte-for-byte and verified by Git blob hash. The original frozen bridge and reader candidate remain unchanged.

No route, UI submission, cron or dispatch is activated. No production SQL, owner allowlist update, actual approval, credentials, provider write, upload, signed URL, or post occurs. The confirmation adapter is callable only by a future independently reviewed server entry point. Tests inject local fixtures.

## Review and confirmation protocol

1. A read-only model binds the current script, canonical character revision and rights assertion, actual finalized MP4 bytes/hash, all eight QA observations, exact caption/time/timezone, brand/user and single network/account. Existing script approval remains required. Plans may be blocked_assets or ready_for_delivery; nothing is cleared by merely reading.
2. The content digest excludes draft approval timestamps and updated_at so a legitimate confirmation does not change the content being reviewed. A separate reviewed-state digest includes the content plus the current generation ID, plan status, draft revision and nullable legacy timestamps. Old clicks fail when that displayed state changes.
3. The owner explicitly begins a reviewed generation. This is not approval: the generation starts with zero confirmations. Server auth.getUser() supplies the actor and server-controlled admin app_metadata must be true. Request-supplied actor IDs or timestamps are ignored.
4. The owner explicitly confirms one named gate at a time: voice, then video, then publication permission. Each call freshly reloads sources and current gate evidence, checks the reviewed-state digest, and calls one atomic RPC. The database, not the browser or adapter, supplies the confirmation timestamp. Each gate remains bound to that generation and exact content.
5. Completed content confirmations make the model eligible for a **separate explicit delivery approval** using the bridge's post-stamp execution snapshot. Publication permission is not proof of scheduling or publication. No content action invokes delivery approval, claim, upload, scheduling or publication.

Historical non-null draft timestamps are display state and concurrency tokens only. They never count as gate evidence. There are no synthetic placeholder timestamps used to pass the bridge's execution guards.

## Explicit replacement and uncertain writes

An ordinary caption, QA, canonical, media, destination or schedule change requires fresh review. An invalidated generation cannot regain consent if an edit is later reverted. The explicit replace_review action creates a new generation with zero confirmations, preserving old evidence in the database archive. Generation identity enters the reviewed-state digest, preventing a click from an old generation from confirming a new one.

The offline SQL extension must forbid beginning/replacing/confirming once any plan sharing the promo draft has a durable provider attempt, including scheduled, submitting or submission_unknown. It archives preclaim delivery approval evidence before making room for a new separately explicit delivery approval. It must also make final delivery approve/read/claim require the current generation and all three exact matching gates, so an older client cannot bypass the new workflow with timestamps alone.

Two plans sharing one promo draft keep independent generation/gate evidence. Shared legacy timestamp updates never grant the other plan consent. They do change an existing exact final delivery snapshot, which requires a separately explicit owner delivery reapproval. In the same still-valid generation, the offline final-approval RPC may archive and replace only a stale preclaim approval; it performs no gate or stamp writes. This avoids sibling reapproval loops and preserves raw snapshot semantics. An unchanged valid approval is not silently rewritten.

A timeout or malformed confirmation response is reported as an unknown outcome. The adapter never retries automatically. A refresh reads durable evidence first; an already recorded gate is no longer the eligible next action.

## Local modules and current limits

- character-promo-review.ts: pure review model, content/state digests, per-gate proof validation and next eligible action.
- character-promo-confirmation.ts: narrow gate-read adapter and fresh-auth explicit begin/replace/confirm adapters; sanitized errors, no automatic retries.
- character-promo-confirmation.test.cjs: mocked protocol and failure fixtures. These establish adapter semantics, not database concurrency guarantees.
- The SQL worker's separate offline extension owns locking, append-only history, replacement restrictions, stamp transitions and current-generation enforcement. This extends/overrides bridge RPCs only in the new proposal; the frozen bridge SQL file is not edited.

The read-only evidence panel at components/admin/CharacterPromoReviewPanel.tsx displays the exact script, canonical context/identities/hashes, eight QA observations, caption, schedule/timezone, account and recorded confirmation state. Stored duration_seconds is the draft target, not measured playback duration. The panel has no action controls, handlers or fetches. Its optional authenticated preview accepts only the exact review-media path and matching hash; an unverified or current-promo preview is never substituted. Actual guarded confirmation, withdrawal/restoration and separately gated transmission controls belong to CharacterPromoReviewWorkspace, not this evidence panel. Explicit withdrawal is available for eligible unattempted plans; attempted targets require reconciliation, and withdrawal never claims provider cancellation. GLYPH rights_status remains an assertion, not independently inspected license documentation; current-video rights QA and explicit owner confirmation remain separate.

Existing SQL and provider activation restrictions still apply. Real multi-session race tests must pass before production rollout. No runtime entry point should be enabled merely because local fixtures pass.

## Remaining plan lifecycle gaps

Draft-wide freezing requires every existing sibling plan to have valid current gate and final delivery approval before the first claim. The read model shows pending sibling blockers; it never approves or changes them. A blocked unwanted account must stay unapproved, not receive consent merely to unblock a different network. This slice does not implement an explicit preclaim sibling exclusion/cancellation flow. Caption/schedule authoring, exclusion choices, the authenticated exact-hash preview, mounted UI, protected action routes, and approved production rollout remain separate work.
