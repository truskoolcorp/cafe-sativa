# Fresh character draft replenishment: source proposal

This is **not enabled**. No provider call, database installation, grant or claim
was made while implementing it. Eight local mocked unit tests pass; PostgreSQL17
execution and independent review are still required before integrating SQL.

## Actual existing backend

The provider module uses the installed `@anthropic-ai/sdk`, existing server-only
`ANTHROPIC_API_KEY`, and the same dated Haiku model as `response-engine.ts`.
It sends one bounded JSON editorial request with maxRetries0 and max_tokens1024.
It does not call the public concierge or reuse private visitor conversations.

## Smallest composition

A reviewed trusted server source loader supplies the character's CURRENT public
canon, canonical revision, voice ID, portrait hash, assigned room, verified
programming, a fresh editorial topic and recent scripts. Persona-specific
collaborator handles must already be verified; unknown handles cannot appear.
The existing provider adapter can be injected as `complete`, and the three-RPC
store as `store`. The cadence key is derived and checked as daily:YYYY-MM-DD:characterId in Dallas
time by both source and SQL. Random request IDs cannot bypass the same daily claim.

Numeric reviewed per-token input/output rates and exact lease expiry are bound to
the SQL budget. A conservative UTF8 request-byte-plus-framing bound and 1024 output
tokens must fit the maximum reservation before claiming. Fresh source and database
claim authority are rechecked before dispatch. The SQL proposal reserves a separate
text allowance atomically before completion.
A cadence key is never reclaimed, and a failed/lost completion cannot cause a paid
retry. The full source snapshot, source digest, actual provider ID, usage and
structured output are persisted. Duplicate spoken scripts cannot be persisted.
No in-memory map is represented as durable idempotency.

## Not a ready production slot

A generated script changes speech content. It therefore needs new rendered audio,
verified audio hash, speech duration and provider-binding evidence. Old approved
speech cannot be silently reused. Draft state is `awaiting_audio_binding_and_qa`,
not `approved`, `scheduled`, or `published`. Current canonical QA, semantic scope
review and publication authority remain independently required. Existing planner
can accept the result ONLY after those materialized bindings produce an exact
candidate slot and reviewed enrollment permits it.

## Activation constraints

* Separately approved text-generation cap and verified worst-case input/output
  rate evidence; **not** the $20 HeyGen allowance. No top-ups or paid test calls.
* Real trusted source loader and clock/cadence configuration; no fabricated facts.
* Review and actual PG17 tests for new owner-only rollback SQL, then any necessary
  specific live-access approval. No runtime grant is part of this proposal.
* Replenishment ledger must be included in inspection/admin status; no green
  readiness message while drafts are only awaiting audio.
* A real complete run and provider publication receipt are still needed to claim
  end-to-end automation.
