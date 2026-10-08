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
