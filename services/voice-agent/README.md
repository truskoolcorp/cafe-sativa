# Café Sativa voice worker

Dedicated Python worker; never deploy over the Anya or Habla Canario services.
This implementation is not enabled or verified with live provider audio yet.

Install `python -m pip install -r requirements.txt`, then `python agent.py download-files`
and `python agent.py start` from this directory. Run unit checks with
`python -m unittest test_memory.py`.

Worker environment: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
CS_LIVEKIT_AGENT_NAME, CS_VOICE_LLM_MODEL, OPENAI_API_KEY, DEEPGRAM_API_KEY,
ELEVEN_API_KEY. Use the ElevenLabs plugin's documented API key variable for the
installed SDK version. Set the same named agent on the website. Website also
requires CS_LIVEKIT_BRIDGE_SECRET; the worker receives scoped grants and does
not need that signing secret. Never put secrets in repository files.

Canonical context and exact voice come from the authenticated website memory
endpoint. There are no persona fallback voices, avatars, executive tools, or
booking/payment functions. Previous dialogue is loaded as user/assistant history.
Writes use stable event UUIDs with bounded retries and an ordered bounded queue.
Authorization failures stop the session. Sessions end after five minutes initially.
Shutdown attempts an eight-second memory drain; unavailable writes can still be
lost on process termination. This is not a durable queue or an aggregate spend cap.

Before enabling CS_LIVEKIT_ENABLED: install/import the pinned SDK successfully,
deploy and verify named registration, connect the website's RTC client, test all
three host voices, microphone turn taking without Send, barge-in, reconnect memory,
cross-user isolation, expired grants, provider failure, shutdown, and usage limits.
Review provider transcript/recording settings before production use. Keep Chef V
excluded under the owner hold. See ../../docs/CS_LIVEKIT_WORKER.md for the endpoint
contract and acceptance checklist.

## Deployment preparation (2026-10-11)
Dockerfile packages the isolated worker; preflight checks required variable names and a valid wss endpoint without printing values. Use the dedicated agent name `cafe-sativa-hosts`. Railway credential references can point to existing `anya-worker` variables without exposing values, but creation of the dedicated service was blocked by the workspace resource limit. No deployment or registration occurred. Keep website live mode disabled.
