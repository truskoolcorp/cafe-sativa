# Private Zaria LiveKit pilot source
This is separate from the shared Café Sativa voice worker and does not change it,
the Stage, deployment manifests, or web routes. No LiveKit dispatch or production
flag is provided here. This worker intentionally cannot start unless its explicit
private-staging configuration is complete. Provider calls have not been run.

## No-send verification
Run `cd services/zaria-voice-agent; python3 -m unittest -v test_pilot` on
Python 3.12+ with standard library only. The fake bridge/socket tests exercise
auth rejection, no dial on invalid input, first-frame assembly, interruptions,
replacement-turn isolation and failure without fallback. They do not test SDK
imports, STT, a WebRTC call, real audio, provider speed or hosted configuration.

## Required private integration (not shipped)
1. Restrict the pilot website to authorized staff or invited participants, require
   opt-in microphone and sign-in; keep text-only Zaria available if voice fails.
   Use an approved isolated HTTPS preview hostname and separate WSS LiveKit project.
   Set the exact host allowlists and credentials below through secret storage.
   Never put credentials or grants in a client URL, console, test recording or logs.
2. Sign the worker grant in the staged app: host zaria, audience and environment
   for this exact bridge, authorized participant/account, assigned room,
   conversation, expiry and nonce. Verify signature, claims, expiry, room,
   ownership and withdrawal/disablement on every admit and turn request. Relay a
   grant only to the named dedicated worker. No web platform/bridge secret goes
   into the worker. The existing web-facing Stage/memory endpoint is not this API.
3. Wire private POST `/api/concierge/zaria/voice-v1/admit` and `/turn`; both
   require the scoped Bearer grant and JSON `{"version":"zaria-gallery-turn-v1",
   "room":"..."}`. Turn adds a final `utterance` (1–1,600 characters) and UUID
   `event_id`. Return JSON `version`, `audience="zaria-private-staging"`,
   `authorized=true`, `room`, `host="zaria"`, `voice_id` and `model_id` matching the
   immutable worker voice. Admit also returns `participant_identity` bound to the
   issued LiveKit token. Turn also returns `speech`, plain text (1–600 chars), from
   the same authorized Gallery answer/selection resolver as text. Deduplicate on
   scoped event_id and enforce a private pilot budget. Reuse the separate
   approved-link UI for navigation; no autopilot, purchase or staff action.
   A read-only memory snapshot is not enough: the shared resolver must run for
   each final utterance. Do not forward grants/links/profile data to synthesis.
4. Check dependencies and pinned SDK signatures with no accounts or private data.
   Configure the isolated projects and register `cafe-sativa-zaria` only after
   the bridge and owner-approved provider cost envelope are ready. Then, with
   synthetic test conversation and real test consent, verify exact Bree + v4
   supports the requested PCM dialogue, both desktop and mobile, microphone
   denial, exact timing and interruptions, six user/room/grant mismatch
   cases, zero fallback/other-host effects, text continuation on failure and no
   private listing or transcript disclosure. No promise of instant response:
   suggested acceptance p95 <2 s from end of speech to first audible word and
   <300 ms to stop at interruption; measure both. Review cold starts and vendor
   usage before enabling persistent service. Do not expose guests until separately
   approved. Use the Zaria flag to roll back without changing other hosts.

Private settings: `CS_ZARIA_WORKER_ENABLED=true`,
`CS_ZARIA_WORKER_ENV=private-staging`, `CS_ZARIA_BRIDGE_ORIGIN` (HTTPS origin only),
`CS_ZARIA_APPROVED_BRIDGE_HOST`, `CS_ZARIA_LIVEKIT_URL` (WSS origin only),
`CS_ZARIA_APPROVED_LIVEKIT_HOST`, `CS_ZARIA_LIVEKIT_KEY`,
`CS_ZARIA_LIVEKIT_SECRET`, `CS_ZARIA_ELEVENLABS_KEY`, `CS_ZARIA_DEEPGRAM_KEY`.
No fallback to shared environment variables. The bridge/SDK integration is not
tested; do not set these flags on production or reuse shared worker credentials.

Official API references:
- https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket
- https://docs.livekit.io/agents/multimodality/audio/#scripted-speech
