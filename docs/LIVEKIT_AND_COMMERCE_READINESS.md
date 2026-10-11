# Café Sativa readiness — 2026-10-11
## LiveKit
Added POST /api/concierge/livekit/session and GET /api/concierge/livekit/memory.
Session creation requires same-origin, an authenticated user, an existing conversation owned by that user and host, and a verified live canonical host. Room names and participant IDs are random opaque UUIDs. Grants permit microphone only, no room administration or data publishing. Join tokens expire after five minutes.
The memory capability is signed, bound to that user/conversation/host, expires within 30 minutes, and is checked against current ownership and ended status on every read. It exposes only the last 20 user/assistant messages from that conversation and verified canonical context.
Disabled by default. Required configuration:
- CS_LIVEKIT_ENABLED=true only after worker/client testing
- LIVEKIT_URL (wss), LIVEKIT_API_KEY, LIVEKIT_API_SECRET
- CS_LIVEKIT_AGENT_NAME (Café Sativa worker dispatch name)
- CS_LIVEKIT_BRIDGE_SECRET (dedicated server secret)
The production project currently has none of these LiveKit credentials/agent settings. Habla Canario's agent must not be reused by inference.
This is authorization and memory-read groundwork, not a completed duplex service. Worker STT/TTS/brain integration, persisted transcript writes with idempotency, session/rate limits, interruption/disconnect handling and Ask-page RTC client remain to implement and test. No UI switch was enabled.

Official implementation references:
https://docs.livekit.io/frontends/reference/tokens-grants/
https://docs.livekit.io/agents/server/agent-dispatch/

## Commerce
Gallery checkout now rejects cross-origin requests, invalid product IDs and non-integer/out-of-range quantities. It blocks non-positive prices and nonphysical products without a delivery asset, and returns a generic provider error.
Production gallery currently has zero products and zero orders. A gallery purchase and fulfillment cannot be honestly marked verified.
Existing webhook issues requiring further work: gallery order and line item/inventory writes are separate; retry after a partial order write can be acknowledged without completion; mutable catalog price is used after payment; digital delivered status does not prove successful delivery; gallery refund reconciliation needs coverage. Do not claim checkout hardening completes these.
Mocked gallery checkout, Stripe entitlements, download access and scoped memory-grant checks pass. No financial transaction, refund or outbound message performed.

## Content and publishing
Five room clips remain rejected for canonical drift. Paid generation remains paused; no retry or new image was generated.
Chef V voice/likeness permissions were confirmed by owner, but all Café Sativa use is on explicit owner hold. CHEF SAYS! is a separate project.
Three existing social deliveries remain scheduled. First approved release: 12 October 2026, 19:00 America/Chicago. Do not advance it merely to demonstrate publishing. Actual provider receipt remains a future check.

