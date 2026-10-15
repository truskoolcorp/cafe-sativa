# Café Sativa dedicated LiveKit voice worker (scaffold)

**NOT READY FOR PRODUCTION. Do not set `CAFE_SATIVA_VOICE_INTEGRATION_READY=1` yet.** The worker intentionally refuses startup until the canonical persona, membership/rate limits, and memory persistence integration is completed.

This is distinct from Railway's offline `anya-worker`. Do not copy Anya's voice ID or owner biometric settings.

## Files
- `agent.py`: separate LiveKit worker that rejects unknown room namespaces and requires per-host ElevenLabs IDs.
- `requirements.txt`: LiveKit Agents 1.6 API family, matching the examined existing worker.
- `test_config.py`: local pure-configuration checks.

## Required server-side variables
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_LAVICHE`, `ELEVENLABS_VOICE_GINGER`, `ELEVENLABS_VOICE_AHNIKA`.

Do not add these to public browser variables. Room-name validation is not an authorization mechanism: a trusted Next.js server endpoint must mint short-lived participant tokens and enforce tier/quotas; the worker must independently verify session entitlements and integrate existing canonical prompts and conversation history before opening access.

## Build and smoke test (local only)
Create a virtual environment, install requirements, and run `python -m unittest discover -s livekit-worker -p 'test_*.py'` from the repository root. Do not run `agent.py start` until the integration and security gates are completed.

## Not yet implemented
1. Server-issued participant tokens, host authentication, and replay prevention.
2. Canonical prompt syncing and existing `host_conversations` / `host_messages` persistence.
3. Exact membership-based usage limits, cost caps and per-session budget.
4. Browser WebRTC room UI / interruption / fallback.
5. Actual worker deployment, browser QA, and audio integration verification.

**Preserve the working Stage 1 voice path as default.**
