# Dormant internal scoped planner entry

Factory only, no registered route, cron, enrollment, credentials or production flag
change. The server wrapper uses the existing `cronAuthorized` bearer verification
and requires `CS_CHARACTER_RECURRING_PLANNER_ENABLED === 'true'` plus an enabled
reviewed manifest. Missing/invalid authorization opens no DB/media/provider sources.

A code-owned immutable enrollment supplies its ID, manifest hash, candidate ordinals
and trusted planner manifest. No request body/query, actor or candidate inputs exist.
An explicitly supplied scoped client reads current SQL enrollment context; the
adapter verifies complete candidate, policy, actor and manifest binding before the
real planner factory can open media/provider reads. SQL resolves the actor again on
writes. This does not treat a cron secret or UUID as independent owner approval.

One finite outer deadline includes bootstrap and the nested planner. It aborts
resources on success/failure/timeout; a late context result cannot start a runner.
Timeout/error after runner entry is conservatively held, never retried. Downstream
SQL remains responsible for atomic planning, idempotence and revocation.

14 local tests pass, including no-open auth/disabled cases, snapshot mutation,
context mismatch, late bootstrap, success cleanup and ambiguous completion. Server
wrapper imports the real cron verifier; unit tests statically verify this wiring,
not a running Next route or live authentication. Focused TypeScript uses existing
local dependencies. No actual DB/provider calls or production activation tested.

Still needed: reviewed finite real enrollment/candidates/current evidence, exact
scoped runtime permissions, registered scheduler and deployed integration review.
This is planning only; generation, QA (including watermark gate), site and social
publication receipts remain separate. No public success is implied by a planned row.
