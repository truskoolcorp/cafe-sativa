# Recurring private QA integration (dormant proposal)

The paid worker must not create arbitrary promotional drafts. A trusted planner
creates the blank draft and binds its exact revision to an authorized slot/script/
character before generation. A separate slot binding has no job foreign key, so
planning can precede claim. Once collection durably reaches `pending_qa`, an atomic
materializer revalidates the slot, completed job and prebound blank draft and creates
the existing QA target. The existing insert-only bridge performs private copy,
byte-hash readback and draft-path compare-and-set. No approval is inferred.

The runner in `character-production-recurring-qa.ts` scans at most five entries
(default one), accepts only database-supplied identities, checks cancellation before
every phase and retains process admission through original transport settlement.
It is not a scheduler, a distributed lock or a hard-deadline transport: composition
must supply abort-aware bounded transports and a shared tick deadline. A separate
post-collection tick avoids starving paid receipt persistence with media copying.

Required integration, not yet enabled:
1. Reviewed slot-binding SQL and real PostgreSQL concurrency/negative tests.
2. Trusted recurring planner that creates blank drafts and exact bindings under a
   finite approved content cadence/budget, without per-item owner setup.
3. Narrow runtime queue/materialization RPC grants and source-lock RLS; no draft
   INSERT authority for the generation worker. Target revocation remains effective.
4. Concrete server transport allowlist, deadline/admission wiring and scheduled
   post-collection execution. This prototype is not imported by production routes.
5. Existing technical QA evidence and publication checks after copying. This stage
   does not mark voice/video/publication approved or dispatch any social post.

Cost/rights: no provider calls or new generation spend in this stage; private
storage and egress may consume existing platform quotas. Proposed rights expose
only prebound draft rows for validation/locking, exact target enrollment, and the
already-reviewed immutable media-path update. Existing original-job recovery,
paid expiry, balances and publication plans must remain unchanged. A successful
mock copy is not evidence that recurring production is operational.

Queue fairness limitation: a draft with an existing dispatch attempt may still look
blank but be frozen by a legacy or Café delivery guard. The trusted planner must
create fresh never-dispatched drafts, not reuse historical drafts. The proposal
does not grant access to private delivery ledgers. Before operational activation,
add a reviewed minimal eligibility check or durable held-item cursor/backoff so
an unexpected frozen entry cannot repeatedly starve later candidates. Existing
freeze guards must remain fail-closed; do not bypass them to force a copy.
