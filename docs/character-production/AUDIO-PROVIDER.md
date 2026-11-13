# Canonical ElevenLabs audio adapter and runtime

This adapter consumes an already generated, authorized, immutable audio transfer
receipt. It makes no synthesis or upload calls and has no production configuration,
credentials, scheduler, or publication route. Activation is disabled by default.
The adapter uses the repository engine types and hardened collection. The audio runtime composes independent current canonical/authorization validation with the exact receipt verifier.

## Verified contracts and what remains unknown

The installed connector catalog was inspected read-only. HeyGen
`create_video_from_avatar` supports `audioAssetId` and optional `audioUrl`; script
and voiceId are optional. This adapter uses **audioAssetId only**, omitting script,
voiceId, voiceSettings and audioUrl, so it cannot silently synthesize a substitute.
An ElevenLabs voice identifier is not proof of a valid HeyGen voice identifier.
Even though HeyGen voiceSettings lists ElevenLabs models, that does not establish
an external canonical voice mapping.

The speech tool `elevenlabs_generate_speech` accepts exact text, voice_id, model_id
and optional speech settings, but declares untyped CallToolResult output. No parsed
synthesis receipt or audio data-URL envelope is invented here. HeyGen's creation
receipt and nonterminal status decoding also remain injected deployment contracts.
The adapter cannot claim successful live production until those are verified.

The available secure transfer route is `create_asset_upload_batch` with explicit
size_bytes, content_type and checksum_sha256 (described as S3-enforced), followed by
completion and asset readback. That is a candidate transport contract, **not evidence
that any upload occurred**. No upload was attempted, and its returned receipts are
untyped. Before implementation, verify exact request/result contracts and approved
sharing scope. HeyGen asset metadata alone does not attest content bytes or source
voice. Never enroll a receipt based only on a playable URL, filename or asset ID.

## Trusted provenance and immutable identity

CanonicalAudioTransferReceipt must be enrolled by a trusted server from verified
source and transfer evidence. It includes:

- Source provider fixed to ElevenLabs, explicit approved model, settings SHA-256,
  source receipt ID and revision, exact canonical character/revision/portrait and
  canonical ElevenLabs voice ID.
- Exact UTF-8 script SHA-256 without whitespace normalization, audio SHA-256,
  exact byte count and measured duration in milliseconds.
- Immutable transfer receipt ID/revision and exact destination HeyGen account and
  audio asset ID. The transfer evidence must attest that identical bytes arrived.
- Exact recurrence key, distinct video-generation/data-sharing authorization and
  expiry, budget period, total authorized quote and period cap.

No model, voice, avatar or real account defaults are supplied. Test IDs/models are
synthetic fixtures. The trusted source must select the approved model and record
all relevant synthesis settings in the settings hash; the adapter does not infer
that an arbitrary model string is supported by a live account.

heyGenAudioBindingRevision commits every receipt field plus the base avatar,
account, HeyGen model and fixed portrait MP4/1080p contract, using an audio-specific
versioned hash domain. That digest occupies the existing providerBindingRevision
in the slot, claim and pending job. A changed script, audio, model, settings, account,
asset or authorization cannot silently reuse an old immutable job identity.

The slot's integer durationSeconds must equal ceil(measured durationMs / 1000).
The exact millisecond value is also committed, so two recordings with equal rounded
seconds remain distinct. Local ceilings are 25 MB and 180 seconds; these are safety
limits, not provider pricing or supported-account claims. A quote must come from
trusted budget policy and account for the intended pipeline's costs without charging
an already-paid synthesis twice. No pricing, refund or synthesis is performed here.

## Required current verifier and engine composition

CanonicalAudioVerifier.validateCurrent receives frozen exact receipt and slot
snapshots plus an abort signal. It is a trusted server dependency, not a client
callback. For each call it must freshly re-read immutable source/transfer records,
current canonical rights and approvals, the exact ready HeyGen avatar and model
capability, and the exact generation/data-sharing/budget authorization. Only exact
boolean true approves. Cached stale flags, truthy objects and get_asset metadata
without transfer proof are insufficient.

Compose createCanonicalAudioSlotValidator into the engine's current validation,
alongside its canonical/authorization checks. This rejects invalid or revoked
provenance before the durable budget claim. The engine rechecks after claiming;
submit independently verifies the exact receipt again immediately before its one
write. Revocation after claim leaves the reservation held without generation.
Never reuse the text-only private HeyGen voice-inventory check for an external
ElevenLabs ID. A live audio composition needs an exact avatar/model check without
requiring the canonical voice to exist in HeyGen's TTS inventory.

The callback verifier is a trust boundary, not a completed integration: until a
real trusted enrollment and current authority source exists, keep this disabled.
The runtime factory remains dependency-injected and disabled by default. There is no scheduler or live transport wiring here. The separate occurrence planner
selects already authorized immutable occurrences; it cannot enroll grants or turn
this adapter on.

## Failure handling and media safety

One absolute deadline covers verifier and create. Monotonic elapsed time and
wall-clock expiry are checked before deferred work, immediately before the write,
after every await, and after decoding. Blocking the event loop or rolling the wall
clock backward cannot turn an expired grant into a request. Signals are aborted
on completion/timeout. A timeout after create starts is an uncertain outcome, not
cancellation: the engine holds it and never retries or refunds automatically.
Injected transports must also disable hidden retries.

Collection requires the exact retained audio binding revision and reads only the
original task. It reuses the sibling hardened HTTPS collector: exact verified origin,
public IPv4 DNS pinning, TLS hostname verification, no redirects, bounded streaming
bytes, MIME/MP4 checks and absolute deadline. Altered/missing bindings hold the job;
there is no regeneration fallback. The output remains private pending QA. Voice
fidelity, pronunciation, full script, lip-sync and visual identity need actual media
review before approval/publication.

## Verification

Run `node --test tests/character-production-*.test.mjs`
from the workspace root. Tests use synthetic transports and receipts only. They
cover asset-only arguments, complete receipt hashes, mutation resistance, current
revocation before/after claim, exact script/model/voice/budget matching, uncertain
writes, original-task reads, slow/blocked-loop/rollback/deferred-start deadlines and
collectable IDs. No live audio/video generation, upload or playback was verified.
