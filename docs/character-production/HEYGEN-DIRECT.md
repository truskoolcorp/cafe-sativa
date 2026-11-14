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
