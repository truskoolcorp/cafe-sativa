# Dynamic YouTube conversation integration

This is the November 9, 2026 preparation for Laviche's Hit Em premiere chat.
The separate ASK link was released in PR57. ASK remains a separate conversation;
this work does not claim that the dynamic YouTube responder is already active.

## Public conversation

- The shared ASK model module preserves ASK's existing behavior. ASK retains
  origin/auth/session/rate/history/FAQ rules and private history ownership.
- The YouTube draft bridge defaults to open-room conversation, without a Laviche
  keyword requirement. It uses the public host persona rather than website voice
  instructions, bounded fresh pseudonymous room context, and per-guest continuity. Other guests'
  room dialogue expires after 60 seconds; the current guest's confirmed public
  exchanges last up to 10 minutes, within the same six-turn bound.
- Laviche speaks naturally with her supported biography, personality, character
  background, and Concrete Rose/Tru Skool identity. There are no routine AI/bot
  disclaimers, but direct identity answers remain truthful. Unsupported personal
  history, memories, physical presence, video perception and audio are not claimed.
- Only authenticated publication receipts add assistant turns. Candidate drafts
  never become assumed prior public replies.

## Local generation service

The dedicated `/api/concierge/youtube` route composes the existing server-side
Anthropic account with a pinned public-event projection, strict request validation,
atomic database reservation, original generation and independent response review.
It does not read private ASK history or raw GLYPH records. The event projection
reads explicitly public columns through the existing anonymous public event view.

The event-scoped bearer is accepted only in Authorization, not URLs/cookies/body.
Live sources must match the exact event, video, chat, account and November 11,
06:00–06:30 UTC posting window. No provider or public-event call occurs before
successful authentication. Missing configuration fails closed. The bearer expires
at event end in code, including on warm deployments.

Generation and review are bounded, have zero automatic retries, observe aborts,
and discard late/expired results. Review uses strict two-key JSON decisions, locally computed exact input hashes
and an original-result check. The model does not need to copy random hashes;
request-specific promises and immutable local snapshots bind each verdict. The route returns a reviewed candidate with public proof
metadata, never sender authorization. Model review and syntax checks are defense
in depth, not proof against every semantic prompt injection or factual error.

The private fixture-only rehearsal is a separate action on the same authenticated
endpoint. It has its own one-use durable budget and cannot accept arbitrary prompts
or clocks. The first production batch returned two failed validations without
recording enough diagnostic detail to identify their exact causes. Its original
two-fixture budget remains consumed and is not reset. A separately versioned
`rehearsal-v2` repair batch adds only allowlisted stage/reason/count/timing metadata,
never generated text, prompts, credentials or review proofs. Both batches are
permanently capped at two fixed fixtures. Their results cannot become live candidates.
The v2 diagnostic batch requires its own reviewed migration and release before use.

## Durable quota

`20261109180000_youtube_generation_quota.sql` creates the pinned event's irreversible
30-attempt reservation budget. Source deduplication and per-author/global cooldowns
are serialized on one row. Database time is rechecked after the row lock. Failed or
uncertain generations remain consumed. Only service-role RPC calls may reserve;
anonymous/authenticated callers and direct service-role table access are denied.
No source message text or generated text is stored in these quota tables.

The reviewed migration was applied to Café production with zero reservations and
zero attempts. It is unavailable outside the event window. Local PostgreSQL WASM
validation covered function execution, permissions, target checks, time boundaries,
cooldowns, rollback, uniqueness and hard cap. Its single backend is not a real
multi-connection contention proof. Later migration edits require a new migration.

## YouTube sender and cutover

The separately armed fixed-reply worker has not been restarted, redeployed or
modified by this Café preparation. Its single-use journal cannot be reset or
silently reused for dynamic replies. A separate runtime candidate is being reviewed
in the Laviche operator repository.

A safe successor must keep authenticated source/target validation, one responder,
durable cumulative budgets, exact reviewed candidate binding, final send-time
checks, no uncertain-send retry and authenticated receipt reconciliation. The
predecessor journal remains intact. One-time transfer requires a verified stopped
zero-attempt predecessor, exclusive ownership and proof that the old process cannot
restart. Missing or uncertain evidence must block activation.

## Release status and remaining gates

The initial Café endpoint was released in PR58, production commit
`80bcd134291afbcf5f8b411a0ec34885eed25e1f`. Public readiness remains unavailable
before the event; unauthenticated requests are rejected. The first private test
made no YouTube posts and consumed no live generation reservations. Its two failed
cases are why dynamic cutover remains held, despite passing offline tests.

Follow-up changes preserve direct conversational continuity, remove unnecessary
model hash-copying, aim for 160 characters within the unchanged hard 200-character
limit, and provide narrowly bounded repair-test diagnostics. Neither protocol
change is a claim about the unrecorded reason for the original failures.

1. Complete and independently review the final route, fixture rehearsal, sender,
   endpoint adapter and one-time successor handoff together.
2. Run aggregate tests, TypeScript/build checks, executable SQL tests and exact
   commit CI. Keep local-only and production verification explicitly separate.
3. Provision only the specifically approved event-scoped service token, without
   exporting provider keys or printing credentials.
4. Run the private real-model rehearsal and verify entitlement, original replies,
   review protocol and latency before cutover. Synthetic model tests do not prove
   real provider judgment or latency.
5. Perform a deliberate single-responder cutover only after all gates pass. Do not
   claim live open-ended YouTube conversation until that deployed path is verified.

No new LiveKit service or unrelated ElevenLabs agent is needed for this text path.
The separate website's speech/read-aloud capabilities do not make YouTube chat audio.
