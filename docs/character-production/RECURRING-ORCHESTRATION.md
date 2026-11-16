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

## Original provider-task collection binding

`createRecurringCollectionSession` uses the existing production composition with
no paid-dispatch budget and a collection-only RPC allowlist. It selects from the
actual pending-task store, re-reads through the real engine, and collects at most
one original provider task per tick. It never invokes the coordinator that could
submit new work. Private output stays behind the existing broker's current exact
authorization and byte readback. A queue disappearing is idle, not publication.
Revocation, malformed records and uncertain provider/storage receipts hold.

This factory is not registered and does not instantiate or extend the expired
canary manifest. Its deployment alone enables nothing. Tests exercise the real
engine, store and broker with synthetic provider/storage boundaries; no live run
or media QA is claimed. Runtime grants, approved current manifest, the other
phase adapters and durable fair selection remain separate requirements.

Durable fairness cannot be implemented by a process-local cursor: production's
current scheduler tables have no per-item next-check/hold cursor. The next
reviewed database proposal must bind backoff to exact enrollment, phase and item
identity, prioritize unfinished original task receipts, allow eligible unrelated
QA items to progress, and never release or reclaim a paid/unknown claim. This is
not permission to install a new table, grant, retry, or reactivate old slots.


## Exact new-generation binding

`createRecurringGenerationSession` selects only a current real SQL due row,
then checks the same key and digest again before the real engine reserves its
nonreclaimable claim. Pending original provider tasks block new generation. It
requires receipt capture, the Dallas budget period and a cap no greater than
$20; actual current wallet/rate/authority checks and SQL spend reservation remain
mandatory inside the existing runtime. The adapter cannot collect media or
publish. Unknown submission is held, never retried. Paid transport receives the
existing wall/monotonic deadline budget from the enclosing recurring tick,
not a fresh longer window. At actual provider dispatch it rechecks enablement,
selected-slot expiry, Dallas month, cap and that same remaining time budget.

This is also a factory only, with no instantiated manifest, route, cron, added
grant or activation. It must be bound to the durable selector's exact item token
before recurring activation; the current due-queue head is not a fair selector.
Tests use actual engine/store/queue but synthetic provider boundaries and do not
establish approved new content or a successful live generation.

## Exact selected-item composition

`createSelectedRecurringSession` now binds the three supported collection,
generation and private-QA adapters to a durable selected token. A separately
provided scoped selector RPC and exact enrollment/manifest are mandatory; no
admin-client fallback or new runtime grants exist. Every selected read validates
the same ordinal/key/digest/token and immutable payload with a fresh database
observation. Collection pending, generation due and QA ready reads use only that
selected payload; generation's original-pending guard still reads real pending
work. A selected item cannot silently change to the legacy queue head.

The stage finishes its bookkeeping only after original work and transports settle,
within the same finite un-aborted lifetime. Unknown work or lost receipts are not
retried. Public cleanup only drains and fences admission; it cannot perform a late
finish. A held SQL disposition is not successful stage completion.

This remains unregistered. The rollback SQL proposal has not been installed in
production, no current policy/candidate has been enrolled, and no real recurring
run is established. Planning, standing authority and delivery/receipt phase
composition remain outside this three-phase factory. Neither synthetic tests nor
code deployment establish current voice/visual QA or watermark-free publication.
