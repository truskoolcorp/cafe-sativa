# Café Sativa — Real-time LiveKit voice integration (Stage 2)

Status: **design / implementation gate; NOT production-ready.** Stage 1 browser-SpeechRecognition turn-taking remains the default until end-to-end tests pass.

## Current, verified integration
- `app/ask/page.tsx`: web SpeechRecognition microphone; POST `/api/concierge` for turn replies; `/api/concierge/speak` for ElevenLabs audio. This is **not** a LiveKit audio room.
- `app/api/concierge/route.ts`: host persona, tier/rate limit, conversation lookup, prior-memory retrieval, Claude reply, persistence.
- `app/api/concierge/speak/route.ts`: server-side ElevenLabs TTS; voice IDs via `ELEVENLABS_VOICE_<HOST>` override and existing defaults; `eleven_turbo_v2_5` default.
- `lib/concierge/personas.ts`: canonical host prompt definitions.

## Target
- Retain host identifiers `laviche`, `ginger`, `ahnika`, exact verified ElevenLabs voice IDs, persona prompts and tenant-specific memory and rate limits.
- LiveKit WebRTC carries full-duplex room audio between browser and a dedicated voice-agent worker.
- Worker supports endpointing / turn detection, streaming STT, LLM response generation, streaming ElevenLabs TTS, and barge-in cancellation; audio echo handling and duplicate turn protections required.
- Stage 1 remains a user-visible fallback whenever a room or worker cannot be provisioned.

## Required server-side credentials (not checked in)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in the **token service / worker server** as appropriate.
- `ELEVENLABS_API_KEY` and named `ELEVENLABS_VOICE_LAVICHE`, `ELEVENLABS_VOICE_GINGER`, `ELEVENLABS_VOICE_AHNIKA` at the worker if TTS runs there (or a protected voice registry service). Preserve existing mapped IDs.
- Authorized LLM and STT provider credentials, if running separately.
- No private keys in `NEXT_PUBLIC_*`, access tokens only minted server side with short expiry and narrow room permissions.

## Implementation plan
1. Identify the **actual** LiveKit Cloud project / worker hosting and any deployed agent service; inspect account configuration read-only before changing variables.
2. Add `/api/concierge/livekit-token` with server-side host validation; authenticate signed-in or anonymous session; enforce access entitlement and rate limits, strict allowed origin, per-session room naming and token expiry. Protect worker join identities. No untrusted room selection.
3. Add isolated agent-worker project with LiveKit Agents runtime, turn detector/VAD, streaming STT, LLM adapter, canonical TTS voices, cancelable responses, and structured errors.
4. Reuse existing authorization, identity, session and host conversation persistence contracts. Never bypass the current usage quota merely by choosing voice transport.
5. Add browser `LiveKitRoom` / audio session connection behind `NEXT_PUBLIC_LIVEKIT_VOICE_ENABLED` (off by default). Display `connecting / listening / thinking / speaking / recovering` and `End call`; default text mode unaffected.
6. Implement failover to the current stage-1 voice flow when room join, worker or audio pipeline fails; preserve the same conversation and selected host.
7. Monitor join latency, time-to-first-audio, interrupted speech cancellations, reconnection success, wrong-voice incidents, token failures, usage and estimated TTS/STT costs — never log API keys or raw personal conversation audio.

## Acceptance tests / release gate
- **Voice canonicality:** each host uses the exact currently verified ElevenLabs voice; changing hosts cannot leak voice, session or conversation memory.
- **Hands-free:** 3+ turns without a button; mic auto-sends only completed utterances; quick pause does not create empty or duplicate messages.
- **Barge-in:** interrupt while host speaks; previous TTS is canceled promptly and the new question is answered, without doubled voices.
- **Transport resilience:** network loss, agent crash, browser permission refusal, provider 429/503, and token expiry display recoverable status and fall back to Stage 1.
- **Security:** no leaked credentials, anonymous tier and authenticated quotas enforced, no cross-user room access, short-lived room token.
- **Browsers:** desktop Chrome and mobile Safari microphone / autoplay tested; text chat still works.
- **Cost:** concurrency cap and a per-session budget, explicit idle timeout and disconnect cleanup.

Do not enable Stage 2 in production until the LiveKit project, running worker, route, and all acceptance tests have been independently verified.

## Infrastructure discovery — 2026-10-08

Checked connected Railway workspace without changing runtime configuration:
- Project `glyph-ecosystem`, production: `anya-worker` already has variable names `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `ELEVENLABS_API_KEY` (values not extracted).
- The production `anya-worker` service is **offline**, with no active deployments. `glyph-ecosystem` and `anya-openclaw` are also offline. Do **not** claim live agent service availability.
- Café Sativa Vercel project currently has `ELEVENLABS_API_KEY` but no project-specific LiveKit variable names in its listed environment. Existing synchronous ElevenLabs TTS works as a separate path.

### Architectural decision pending
First validate the intended LiveKit Cloud project and whether it permits per-brand isolation. Do not copy Anya's credentials into a new app blindly. Prefer distinct API credentials or distinct LiveKit projects, named rooms and identities, separately deployed workers, and independent quotas. Do not turn on the Stage 2 UI until a worker is deployed, connects to rooms, and passes audio/barging tests.

## Authorization and memory bridge implementation (draft, 2026-10-08)
Code in this PR now includes:
- SQL migration for `cafe_voice_sessions` scoped room authorization ledger (not yet applied).
- `lib/concierge/livekit-authorization.ts`: validates signed-in user or anonymous session, active membership tier, ownership of existing conversation ID, and fail-closed quota check. Anonymous session IDs remain client-controlled as in existing chat; production should bind them to signed server cookies to avoid impersonation.
- `POST /api/concierge/livekit-token`: gated room creation and short-lived token minted by server with only microphone/subscribe permissions; requires installed `livekit-server-sdk` dependency and applied SQL migration.
- Internal worker routes `/api/concierge/livekit-worker/context` and `/turn`: authenticated with dedicated secret, reject rooms absent or expired in ledger, deliver canonical persona and current/prior history, and record finished dialogue turns.
- Worker route authentication uses a constant-time digest comparison and does not put any secrets in the browser.
### Hard blockers before enabling
1. Wire worker to fetch room-scoped context, use the canonical instructions and memory and send verified completed turns; its current `TEST_PERSONAS` are not acceptable for production.
2. Replace non-atomic count/insert quota with transactional usage reservations and per-turn idempotency IDs, plus daily/overall session cost and duration ceilings.
3. Enforce room participant identity and server-issued session binding in worker; enforce expiry and revocation throughout an active call, not just startup.
4. Apply migration and install/update lockfile in CI; inspect environment-scoped secrets separately without exposing values; configure distinct worker credentials; test worker callbacks and frontend.
5. CSRF/session protection: exact origin comparison is a supplemental check, not sole authorization. Harden anonymous session IDs using HttpOnly signed cookies.
6. Explicit feature flag `CAFE_SATIVA_LIVEKIT_ENABLED` must remain unset/disabled. No deployment or runtime test was performed.
