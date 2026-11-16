# New finite included-speech operation: inert review

No request made, key read/copied, route mounted, old canary altered or activation.
New operation is separate from `zaria-eleven-v4-included-canary-v1`, which is
explicitly rejected. New candidate `zaria-gallery-look-again-v1` remains a draft;
its missing current canon revision and owner-scope reference are NOT fabricated.

## Exact resource/scope
The existing server-key transport pattern is reused with a captured key per factory.
Quota/model/voice GET and synthesis POST share that exact key, so connector-account
billing assumptions are unnecessary. Before POST, quota is re-read from the same
client: no overage entitlement, consistent extension fields, at least10,000 remaining
included credits, observed canonical custom voice rate1 and supported bounded model
rates. At most250 script characters and1MiB/30seconds output. These are admission
bounds, not a quoted credit-to-dollar conversion or global quota reservation. Other
account consumers may race quota reads; no overage entitlement is the spend boundary.
At most250characters×4model multiplier is1000 base units against a10,000credit
margin; custom voice rate1 is observed, not asserted as a final billable estimate.
No top-up, subscription change or claim that observed balance remains current.

One private insert-only claim at `production-speech-operations/<key>/claim.json`
precedes provider submission and is never released. Conflicts/unknowns hold; there
is no automatic retry or reclaim. Same provider factory refuses a second attempt.
Provider request ID+output hash are persisted in provider-receipt.json before media
storage/measurement. Exact audio is inserted once into existing private audio bucket,
read back and hashed. Strict MPEG1 LayerIII128kbps44.1kHz full-frame parsing measures
duration; unsupported/truncated formats hold for inspection rather than guessing.
Final receipt.json binds exact script/canon/voice/model, hashes and measured duration.
Claims, provider receipts, audio and final receipts are never overwritten.

This is not voice recognition, lip-sync approval or publication clearance. Final
receipt remains private_pending_qa, qaApproved=false/publicationApproved=false.

## Still needed before calling
- Exact finite authorized script scope; live canon reader must bind revision,
  portrait, voice and model. No synthetic fixture values allowed.
- Instantiate reviewed server-only createFiniteIncludedSpeechHandler with actual
  current canon revision/portrait and finite authorization. The new factory uses
  isContentAdmin, fixed same-origin empty-body POST, liveGlyphCharacters plus
  normalizePromoCanon exact revision/portrait/voice gates, existing createAdminClient
  with bounded storage fetch, captured ELEVENLABS key and strict MP3 measurement.
  No route or operation is instantiated, and the new environment flag defaults off.
- New authenticated handler owns a90second total deadline and5second auth limit;
  request body/query and wrong Origin reject before credentials/storage open. Busy
  latch lasts until underlying work settles, including after timeout response.
  Initial preflight above15seconds rejects before durable claim. Redundant postclaim
  quota read is removed; provider performs mandatory fresh same-key quota immediately
  before POST and server refuses POST after30seconds from opening. This leaves at
  least55seconds after auth for12second provider response, six3second storage ops,
  final canon verification and margin. Future mounted route must permit>=90seconds.
  No late POST after cancellation/admission cutoff; consumed claims never retry.
- Confirm existing private bucket metadata and current storage write capability.
  This code uses existing insert/download SDK capabilities, requires no new SQL
  tables/roles/RPC grants, no public storage and no new credential. If live storage
  permissions are path-restricted to the old canary, the exact new claim/receipt
  prefix needs separate scoped permission review. Do not broaden bucket access.
- No POST should be invoked until parent-managed authorization and review complete.

25 local tests pass; focused strict TypeScript passes. Fixtures use fake media,
provider and storage, not live included-credit consumption or durable database proof.
