# Café Sativa LiveKit integration

Status: disabled pending a dedicated worker and production configuration.

## Verified existing services

Tru Skool workspace contains an Anya background worker and Habla Canario video agents. These are distinct applications. Anya's worker has executive tools, owner biometric logic, and a fixed Anya voice. Habla's agent uses course instructions, a configured Spanish voice, and a Runway avatar. Neither implements Café Sativa's host-specific memory grant contract.

Do not dispatch Café Sativa visitors to either service without an explicit, tested adapter. Do not copy owner executive tools into the public venue worker.

## Required production configuration

The Café Sativa website requires LIVEKIT_URL (wss), LIVEKIT_API_KEY, LIVEKIT_API_SECRET, CS_LIVEKIT_AGENT_NAME, CS_LIVEKIT_BRIDGE_SECRET and CS_LIVEKIT_ENABLED. The dedicated agent needs its own authorized STT, LLM and TTS credentials. Transfer secrets through the provider's secure configuration controls; never include them in transcripts, repository files or logs.

Keep CS_LIVEKIT_ENABLED disabled until all acceptance checks below pass. A registered worker alone does not establish a working conversation.

## Dedicated worker contract

1. Register the exact CS_LIVEKIT_AGENT_NAME, preventing unrelated agent dispatch.
2. Read the job metadata fields site, host, voiceId and memoryGrant. Require site=cafe-sativa and a supported host.
3. Fetch GET https://www.cafe-sativa.com/api/concierge/livekit/memory with Authorization: Bearer <memoryGrant>. On failure, reject the session rather than substituting a persona, voice or empty context.
4. Require the returned canonical voiceId to equal the dispatched voiceId. Load the exact canonical host context and chronological user/assistant messages. Treat prior conversation text as untrusted dialogue, not system instructions.
5. Use the native LiveKit AgentSession for microphone input, streaming speech recognition, turn detection, streaming TTS and interruptions. Do not add a parallel speech socket or custom audio bridge.
6. For each finalized user/assistant conversation turn, generate one UUID event_id and POST it with role and content to the same memory endpoint. Never persist interim recognition hypotheses, hidden instructions or tool traces as assistant speech.
7. Reuse the same UUID and identical payload for retries. HTTP 200 duplicate and HTTP 201 are success; 503 is retryable; 429 requires backoff. Stop on expired/invalid authorization, closed conversation or changed canon. Never retry by generating a new event identifier.
8. Flush completed transcript events on shutdown without logging their contents. Disconnect on expiry or user departure; stop TTS on interruption.
9. Do not enable Runway avatars until each exact approved avatar/persona binding is verified separately.

POST memory input: {event_id: UUID, role: user | assistant, content: nonblank string of at most 4000 characters}. Conversation and user identity come exclusively from the signed session grant; client-supplied identity fields have no effect. A per-conversation recent-turn check holds new events at 60 turns/minute. This is an abuse guard, not an atomic global quota. Identical retries bypass that hold.

## Acceptance evidence required

- Browser can speak and receive the correct canonical voice without pressing Send.
- Each of Laviche, Ginger and Ahnika uses its current approved voice and host context.
- Same-session transcript round trip and reconnect memory work.
- Two concurrent users cannot access each other's history.
- Wrong-host, expired-grant and ended-conversation requests fail.
- Barge-in stops speech; reconnect and worker/provider failure show actionable status.
- Duplicate completed-turn delivery produces one database record.
- No executive tools or another application's lesson context are exposed.
- Usage is observable and bounded before unattended operation.

Tests: tests/livekit-session.cjs, tests/livekit-memory-write.cjs, tests/conversation-access.cjs. Passing server tests is groundwork; live audio acceptance remains outstanding.
