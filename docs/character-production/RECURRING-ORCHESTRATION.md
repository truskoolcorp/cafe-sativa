# Dormant recurring orchestration boundary

`createCafeRecurringEntry` provides a bounded internal tick with default denial,
existing secret authorization supplied by trusted composition, and no HTTP input
for choosing stages or candidates. It executes only one server-selected stage:
collect, receipt reconciliation, planning, generation, private QA, standing
authority or dispatch. These are separate ticks, not a chain of paid work inside
one request. Missing adapters fail closed without legacy fallback. Cancellation
or deadline returns held; admission remains occupied until original work and all
transports settle. Failed settlement keeps this instance held. Database claims
remain necessary across instances, retries and restarts.

This is a coordination contract, NOT completed integration. No live adapters,
production route, cron entry, environment flags, grants or enrollment are created.
Existing modules to bind in a separately reviewed trusted server composition:

- `createPlannerEntry`: finite scheduler enrollment and canonical candidate set.
- `createInternalCharacterWorker`: collect original paid tasks before fresh work,
  retaining existing durable budget and unique-claim fences.
- `createRecurringPrivateQa`: exact existing slot-to-draft binding and private copy.
- `createCafeStandingServer`: real candidate QA, enrolled authority and separately
  authorized semantic-inference budget, never inferred owner consent.
- `dispatchCafeMetricool` adapter in `character-promo-cafe-metricool`: scoped existing
  delivery claim and external receipt identity, with duplicate guard unchanged.
- Existing read-only provider receipt reconciliation, without submission replay.

The trusted durable selector must prioritize unfinished original tasks and
receipts, obey finite approved cadence/budgets and prevent held-item starvation.
It must not invent candidate IDs or reuse previous introductions. Every adapter
must validate current enrollment/revocation itself and provide reliable settlement.
The request handler does not replace those controls or grant any rights.

`stage_settled` means only the adapter promise settled. It is never publication,
QA approval, provider delivery or end-to-end readiness. A separately read actual
receipt must establish those outcomes. No downstream stage is auto-triggered.

Before activation: reviewed real server adapters and selector; effective scoped
permissions; authentic content/QA and finite owner policy; separately approved
inference allowance; current paid provider configuration within $20 Dallas-month
HeyGen cap and no top-ups; no third-party watermarks; reviewed cron and runtime
flags; independent integration tests and one real receipt-verified run. Existing
past canary windows must not be extended or silently reused.

## Concrete private QA binding

`createRecurringQaSession` now uses the same `openPrivateQaSession` as the
existing private-QA route: exact four-function RPC allowlist, cancellation and
no retry, verified private destination and original immutable bridge. Selection
reads one current eligible database slot; the real recurring runner re-reads
eligibility before materialization/copy, so a completed/revoked slot is not
resurrected. No caller candidate or synthetic row is supplied. The adapter
rechecks the existing QA flag, binds one AbortSignal, and consumes at most one
stage. Empty re-read means no work, not proof of ingestion.

The new adapter is not registered in a route or scheduler and has no new flag or
grant. Other phase adapters and the overall durable/fair phase selector remain
outstanding. QA queue head starvation from existing frozen drafts remains an
operational limitation; do not activate recurrence until durable backoff or
reviewed eligibility handling is available. Database mocks exercise the real
runner, but do not prove live eligible content, grants or storage-copy success.
