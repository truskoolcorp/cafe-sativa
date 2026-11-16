# Direct HeyGen v3 transport and read-only diagnostic

Dormant transport implements existing HeyGenTransport/HeyGenCodecs interfaces,
not a fabricated connector envelope. Fixed api.heygen.com, X-Api-Key from existing
server env accessor, no redirects/retries, bounded response/deadline. POST maps
explicit avatar/script/native voice/engine/aspect/output format fields; only an
explicit native voice allowlist may be used. Direct account binding is a local
verified configuration identifier, not proof that the API key matches an OAuth
connector account. Inspect account and private inventory before authorizing.

Admin-only GET /api/admin/character-promotions/provider-diagnostic reads existing
HEYGEN_API_KEY in the deployed backend only and makes three GET requests. Returns
sanitized account/billing summary and first private avatar/voice pages with
complete:false if more remain. It cannot approve canonical mapping or spending.
No key decryption/copy, new secret, provider POST or paid generation was performed.
An installed route is pending independent review/deployment; code existence is
not a successful production diagnostic.

Direct receipt is data.video_id/status; status is data.id/status/video_url.
Creation with downgrade note/720p is rejected, but that can occur AFTER provider
acceptance/billing: engine must retain unknown claim, never retry creation.
HTTP error/malformed response likewise remains uncertain, not a free retry.
Current provider engine still owns exact slot/claim/budget handling. Native API
credit wallet differs from OAuth subscription; sufficient balance is NOT approved
spend or a binding quote. There is no API hard dollar limit in this payload.
Do not enable generation until approved worst-case cost and account match verified.

## Canonical ElevenLabs audio, especially Bree

An ElevenLabs voice ID is NOT a native HeyGen voice ID. Do not silently select a
similar HeyGen voice. Correct supported route: synthesize exact approved script
with canonical ElevenLabs voice, retain immutable audio hash/voice/model/script
provenance, then supply audio_url OR audio_asset_id to POST /v3/videos with avatar_id.
Do not send script+voice_id with this audio. audio_url must be provider-accessible
HTTPS; a short-lived exact private signed URL is a bearer disclosure to HeyGen,
not a public permanent media asset. Audio asset upload is a separate authorized
step with receipt. No guessed provider mapping or TTS call is included here.

Before adding audio submission to this engine, extend immutable binding/slot
validation to include exact audio hash/source/voice/model/script revision and
separate TTS budget/unknown-write handling. Existing voiceId-only binding cannot
safely prove which pre-rendered audio will be used. This remains a real dependency,
not a reason to substitute a native voice. Existing ELEVENLABS_API_KEY has not
been accessed by this implementation.

Official sources checked November14:
- https://developers.heygen.com/reference/create-video
- https://developers.heygen.com/reference/get-video
- https://developers.heygen.com/reference/list-avatar-looks
- https://developers.heygen.com/reference/list-voices
- https://developers.heygen.com/reference/get-current-user
- https://developers.heygen.com/audio-to-video

Current list-voices reference is /v3/models/audio/voices (not legacy /v3/voices).
Read-only first-page inventory is intentionally not a replacement for full
canonical ownership/model-capability verification.

## Reviewed-code candidate: native inventory and rendered-audio binding
`createDirectHeyGenRuntimeProvider` now returns a coupled native API transport,
strict codecs and direct `verifyBinding` callback usable by the existing runtime.
It compares the exact configured API account username, complete private-look page,
model support and either complete native voice page or the exact trusted audio
manifest digest. Incomplete first pages fail closed; no synthetic connector
`content/items` envelopes or discovery-driven canonical mapping are used.

A rendered-audio manifest binds exact script bytes (SHA256), canonical voice ID,
ElevenLabs model, synthesis receipt, portrait/canonical revision, avatar, audio
hash/size/MIME. Its digest is included in the provider binding revision, preserving
legacy native hashes when absent. Changing the audio or script therefore requires
new exact authorization, not reinterpretation of an old slot. The coupled factory
rejects mismatched/duplicate manifests and ambiguous avatar/voice pairs.

The audio transport reads an exact immutable hash-addressed private MP3/WAV through
an injected trusted backend source, checks hash/length/signature/script/voice, then
requests a capability for that same path in private `character-production-audio`.
Only the exact configured Supabase HTTPS origin/path/token is accepted. The HeyGen
v3 request uses `audio_url` and omits both `script` and `voice_id`, avoiding a native
voice substitution. Signed URLs are capability secrets and must not be logged.

Remaining real dependencies: separately approved ElevenLabs synthesis and durable
trusted receipt storage; current canonical model/voice confirmation; private audio
bucket with insert-only immutable hash paths; bounded backend audio read/sign
adapter using existing server credentials; sufficient URL validity for asynchronous
HeyGen retrieval; native read-only account verification; exact quote/budget/slot.
The source adapter is an internal contract, not a claimed provider token API. No
synthesis, asset upload, paid video, grants, keys or environment changes occurred.
Hash/provenance validation is not listening QA or proof of voice authenticity by
itself; only a trusted synthesis receipt can establish the claimed voice origin.

### Existing ElevenLabs route audit and safe inventory probe
The existing host TTS route restricts Keith/Laviche and fixes `eleven_turbo_v2_5`;
the concierge route covers Laviche/Ginger/Ahnika and defaults to that model. Neither
creates immutable production synthesis provenance and neither is a Bree production
receipt adapter. Calling either is paid synthesis, not an inventory check.

The new admin-only voice diagnostic performs only official GET `/v1/models` and
GET `/v1/voices/{voice_id}` using the existing server key accessor. It checks exact
Bree ID `5zneNR4v1Uw5AjIZ9Un4` and requested label `eleven_v4`; absence is reported,
not silently mapped to v3/turbo. It returns no samples, audio URLs or key. No live
probe was run here. References: https://elevenlabs.io/docs/api-reference/models/list
and https://elevenlabs.io/docs/api-reference/voices/get .

A future synthesis transaction must claim a separate exact script/voice/model cost
reservation before POST, retain unknown outcomes without retry, capture a verified
provider receipt and hash actual bounded bytes, store insert-only private audio,
read back the exact object and atomically persist provenance. The present video
ledger does not reserve ElevenLabs synthesis cost. Do not reuse its HeyGen quote
or make paid TTS calls until that separate authorization/persistence exists.
