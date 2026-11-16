# One direct server API speech canary (proposal, not active)

Purpose: prove actual deployed server ELEVENLABS_API_KEY can synthesize canonical Zaria/Bree using `eleven_v4`, not a separate connector. One fixed request only. No publication, overage, top-up or subscription change. Included credits are a consumable resource, not zero monetary cost.

## Exact proposed input
- Voice `5zneNR4v1Uw5AjIZ9Un4`, model `eleven_v4`.
- Text: `Welcome to the Gallery at Café Sativa. I'm Zaria Solenne.`
- `mp3_44100_128`, maximum output 1 MiB, server-side only.
- Same live canonical asset/portrait/revision as the reviewed original Zaria import; changed or unavailable canon holds.
- Fixed unique operation `zaria-eleven-v4-included-canary-v1`; no caller IDs/text/models/paths.

## Durable reservation, without pretending included credits are cents

Existing speech SQL requires positive cents quotes/budgets and is not used with invented zero values. Proposed alternative is an insert-only JSON reservation in existing private `cafe-sativa-characters` (exact reviewed 10 MiB metadata, PNG/JPEG/WEBP/JSON types). A single globally fixed `production-canaries/zaria-eleven-v4-included-canary-v1/claim.json` is created with a cryptographically random nonce, exact input digest, included-resource authorization and current provider preflight facts. Only a confirmed NEW upload plus exact nonce/hash readback permits the POST. Existing/conflicting/unknown insert holds permanently; no reset, delete, overwrite or retry. This relies on provider insert-only atomicity and trusted backend retaining the marker, not database-isolated authority or global account quota reservation.

A provider request that times out or loses a receipt is unknown and never repeated. Successful bytes go insert-only to `character-production-audio/audio/<sha>.mp3`, private readback is verified, and a separate fixed JSON receipt is written insert-only and verified. The reservation remains consumed even if any later step fails. No signed/public URL or credential is returned.

This storage-reservation design has parent acceptance for isolated implementation; independent review remains required before activation. It does not authorize new storage policies or grants. An included-credit SQL ledger is the alternative if existing private JSON storage is not an accepted durable authority boundary.

## Current provider evidence required before any POST

Use official GET `/v1/user/subscription`, `/v1/models`, `/v1/voices/<canonical voice>` through the existing key. Verify model availability, exact canonical voice and provider's current resource fields. Require provider overage unavailable (entitlement false) or explicitly disabled by cap zero; report those separately. Require deprecated allowed boolean consistent with cap, not only the older sanitized `overageEnabled` approximation. Require at least 10000 remaining included credits, explicit finite model character multiplier >0 and <=4 plus discount >0 and <=1, and no custom voice rate. This is a substantial availability margin, not an exact cost quote or global reservation. Do not assume one text character equals one credit. Recheck directly after reservation and immediately before POST. Concurrent unrelated account usage is outside this reservation; provider-enforced disabled overage is essential.

Current docs expose model `model_rates.character_cost_multiplier`, `cost_discount_multiplier`, and `token_cost_factor`; voice custom rates may change consumption. Missing/contradictory rates are a hold, not invented pricing. Existing account's last observed 100398 remaining is not fresh authorization evidence.

## API and security constraints

Admin+exact Origin, bounded empty Next request body, per-process admission until original promises settle, finite deadline/cancellation, fixed provider origin, one POST, no automatic retry. Durable storage reservation supplies cross-instance no-repeat control. Existing server credential stays backend-only. Account billing/identity raw JSON is not logged or returned. Output is pending technical QA only.

## Primary references inspected (2026-11-14)
- https://elevenlabs.io/docs/api-reference/user/subscription/get/
- https://elevenlabs.io/docs/api-reference/models/list
- https://elevenlabs.io/docs/api-reference/voices/get
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- https://elevenlabs.io/docs/help-center/account/general/how-is-character-length-calculated
- https://elevenlabs.io/docs/help-center/account/general/have-characters-changed

No model synthesis, provider billing mutation, storage write or credential access has been performed in preparing this proposal.

Implementation route remains hard-disabled. Exact model-rate and voice-rate metadata plus raw deprecated allowance field must pass the strict parser; current sanitized diagnostic alone cannot prove those facts. The one-shot claim can consume this test permission even when the POST is never reached.

Read-only authenticated GET now exposes only bounded quota/rate compatibility facts; synthesis remains disabled. Auth is bounded at5s, overall readiness18s, admission retained until original work/provider operations settle. Resource route reuses45s handler: max6s auth/body, monotonic pre-speech admission at9s into operation,12s direct provider timeout, five3s backend storage stages and3s margin. Slow preflight after claim consumes permission without attempting synthesis. Provider fetch, response-read and cancellation settlement participate in admission, not only Supabase requests.

## Narrow owner-authorized activation follow-up
One fixed 54-character Bree/v4 call is enabled by this reviewed patch. Fresh raw
voice sharing.rate must equal1 and overage entitlement must be false; any changed
rate, including0, holds. This observed custom rate is NOT interpreted as a credit
multiplier. Claim and receipt preserve observedCustomRate1 and creditEstimate:null.
Actual included-credit delta must be measured after the one call. All original
fixed-input, private storage, immutable claim and no-retry fences are unchanged.
No call was made while authoring this patch. Earlier disabled-tranche description
applies to the prior deployment only, not this activation candidate.
