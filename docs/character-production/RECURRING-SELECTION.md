# Durable fair selection proposal: existing production phases

Status: **offline owner-only SQL rehearsal**, not installed or granted, and not
connected to production. It ends `ROLLBACK`. Only a disposable PG17 fixture may
commit it. An independently reviewed installer, exact live catalog comparison
and applicable access approval are prerequisites for a future installation.

## What this covers

- Exact existing immutable scheduler enrollment and ordinal, original slot key
  and digest. No HTTP-supplied slot, candidate, actor, script or schedule.
- `collect`, `qa`, `generate` eligibility from the actual existing production
  ledger. It does **not** implement planning, public receipt reconciliation,
  semantic authority or social dispatch selection.
- A durable per-enrollment/ordinal/phase selection token recorded before an
  operation. Concurrent instances serialize on the existing enrollment lock;
  no process-local fairness counter is presented as durable state.
- Unseen eligible items are selected before previously polled ones. Original
  collection wins equal-age ties, followed by QA, then generation. Pending
  original jobs block **generation**, not unrelated QA.
- An original task whose polling completed normally but remains `submitted`
  receives exponential polling backoff (60 seconds to 1 hour, max 1,000 polls).
  This changes only scheduling state, not paid provider claims or retries.
- Any unknown result remains `in_flight` indefinitely if the worker cannot
  establish settlement. Explicit `held` is permanent. No expiry/reclaim/reset or
  unlock API exists. Other items can advance without retrying uncertain work.
- `done` means only that the scheduling stage need not be repeated. A generation
  stage with an existing `unknown` job can be done in the selection ledger while
  that job still blocks further generation. It is never publication evidence.

## Exact selected identity integration contract

`character_production_recurring_next(enrollment)` returns a database-issued
`selectionToken`, `phase`, `ordinal`, `key`, `digest`, manifest digest, observed
server time and exact existing stage payload. The caller must retain that entire
identity. `character_production_recurring_selected(enrollment, token)` rechecks
current enrollment and eligibility and returns **only that item**.

A stage adapter must consume that selected identity, not call an unrelated
queue-head selector and act on whichever row appears. For the existing adapters:

- generation: adapt the exact selected payload into a one-row due response;
  compare key/digest/enrollment/ordinal/token before produce; retain all engine
  budget, canon, provider and unknown-claim fences;
- collection: adapt selected original pending-task payload into a one-row pending
  response; never substitute a different task ID after selection;
- QA: adapt selected key/digest into the one-row ready response and keep exact
  materialization and private-byte readback checks.

These mappings are a required subsequent integration, not implemented by this
SQL alone. Existing PR168/169 queue-head factories must **not** be plugged into
this selector unchanged. No new grants or credentials are in this proposal.

Only after the original stage and every transport has settled may the adapter
call `character_production_recurring_finish(..., 'settled')`. A known-held result
uses `'held'`; unknown settlement makes **no finish call**. Finish independently
checks actual paid-job/ingestion receipt state and never edits source jobs,
budgets, approvals, scheduled posts, credentials or media.

## Verification

`tests/postgres/validate_recurring_selection.py` uses the real chained restricted
owner/planner foundation in a fresh disposable PG17 cluster. All test candidates
and transitions are synthetic. It tests rollback, denied public/runtime grants,
concurrent distinct selection, original-receipt priority, exact readback, held
head bypass, durable backoff, non-reclaim after old timestamps, stale-token
rejection, no paid-job/budget mutation, actual receipt-derived completion and
revocation. CI must pass before this proposal is described as verified.

The proposal asserts exact owner-only ACLs even under unexpected default grants,
and every public wrapper rejects non-READ-COMMITTED snapshots. These constraints
are tested in the same disposable fixture, not by changing live permissions.

Tests do not prove content/voice/video quality, live enrollment, platform delivery
or a running recurring pipeline. Those still require genuine production evidence.
