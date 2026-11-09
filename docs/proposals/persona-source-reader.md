# Read-only persona source integration slice

This sibling candidate adds a dormant trusted source reader and fixture tests to the frozen delivery bridge. It does not add an entry point, UI, approval transition, database change, credentials, provider write, upload, signing call, or publication.

## Existing source contracts used

- `cs_character_promo_delivery_plans`: exact ID, promo/character identity, network/account, UTC schedule, status, and caption. The caption column is part of the separately reviewed offline bridge ledger proposal; without it the reader fails `plan_unavailable`, explaining the schema dependency.
- `cs_character_promo_drafts`: exact ID, character, script/visual brief/duration, routing, private media paths, final approval timestamps, status and updated_at. Missing approvals remain null. They are never inferred from upload or QA observations.
- `cs_character_promo_qa_checks`: all eight fields of each current-promo/current-video observation: ID, promo ID, hash, check, result, evidence, reviewer, created_at. A nine-row sentinel limit detects unexpected overflow instead of silently truncating to eight. Missing observations stay missing and block the delivery evaluator.
- `cafe-sativa-content` private bucket: only `character-promos/keith/{matching-promo-UUID}/{sha256}.mp4`. The downloaded Blob size must be 16 bytes through35MiB before the additional arrayBuffer copy; actual size, MP4 header and byte SHA-256 must match. Supabase download may already buffer its response before returning the Blob. This checks object and copy size, not transport-level buffering; a future streaming transport needs a separately reviewed bounded reader. No signed URL is requested and no bytes leave storage reads.
- `liveGlyphCharacters()` from `glyph-live.ts`: existing consumers `concierge-canon.ts` and `host-portraits.ts` establish canonical_context, primary_asset_id, sha256, voice_id, rights_status, voice_status and production_ready. The dependency named `readGlyph` expects this parsed registry function, not the lower-level Response-returning `readGlyph()` HTTP helper.
- Metricool `getBrandSettings`: the existing integration consumes either rows directly or `.data`. Exact brand5373515/user4174093 and Facebook146219355471397/Threads truskoolcorp are required. Duplicate brand IDs are rejected. No fallback destination.
- `cs_read_character_promo_approval`: narrow service-only read RPC from the separate ledger proposal. Missing/invalidated/unauthorized records remain absent; the reader does not call approve, claim or finish.

## Canonical assertions versus rights documentation

GLYPH rights_status='approved' is an upstream assertion, not independent license documentation. The reader does not invent or require an unestablished `rights_evidence` field, infer owner attestation, or import historical snapshot IDs as live proof.

The revision fingerprint hashes the complete current character payload, including canonical_context and every actual nested evidence field supplied by GLYPH. Only portrait_url is excluded because the existing GLYPH helper constructs it as a local presentation URL. Changes to context, IDs, status, or exposed rights evidence invalidate the fingerprint. Unrelated registry envelope generation timestamps are not character evidence and are excluded.

This binds the evidence actually exposed by the current character source. It cannot prove undisclosed license terms. Current-video rights QA and explicit owner/content/delivery approvals remain independent gates in the bridge. If stronger documentary rights proof is needed, define its required source and review separately instead of inventing an upstream field.

## Consistency and future wiring

The reader loads draft/plan/QA, downloads and hashes private media, requests live canon and brand settings, then reloads the exact DB records. Observed differences reject the review. Reverted (ABA) changes or some interleaved reads can escape double-read comparison; this is not a consistent database snapshot or a substitute for the atomic ledger. Remote freshness is measured from request start, so a slow request cannot masquerade as fresh evidence. All records are read again on every call, without cache.

These reads alone are not an atomic claim. The frozen bridge's SQL claim/freeze semantics and post-claim revalidation remain necessary. Remote source changes cannot be transactionally locked by PostgreSQL. `readApprovedCharacterPromo()` additionally checks current final approvals and exact approval snapshot digest before returning execution inputs.

Future server wiring can inject an existing Supabase admin client, `liveGlyphCharacters`, a read-only current session's `getBrandSettings`, and a clock. Type compatibility with the actual admin client was compile-checked without constructing a client. Avoid `withSocialConnection` for a strictly read-only readiness endpoint: that helper writes connection health and may refresh OAuth. No such binding is added here.

Next independent engineering step: consume this reader in a separately reviewed read-only admin review model, showing precise blockers and keeping missing final approval actions disabled. Final content approval transitions/UI are outside this slice.
