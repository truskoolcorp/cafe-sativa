# Scoped original-media planning (dormant)

This change connects existing enrolled planning to immutable occurrence snapshots.
It does not create a policy, enrollment, candidate, wallet proof, route instance,
credential, grant, generation, or publishing approval.

A reviewed `PlannerImageManifest` may carry `snapshotText`. Bound manifests must
not mix bound and static proofs. The exact candidate selects one snapshot whose
original image/audio digest and provider binding match its immutable slot.
`createPlannerEntry` freezes this snapshot into its scoped candidate adapter.

The existing trusted composition still checks current policy twice, live canon,
rights, theme, actual provider account, private image/audio bytes, and fresh quote.
Only after these pass does the binding reader return the snapshot SHA evidence.
The scoped adapter retains exact candidate/actor/schedule checks and calls:

`character_production_scheduler_plan_bound(uuid, integer, jsonb, text)`

SQL resolves the current enrollment, policy and actor with `scheduler_current`,
loads the immutable candidate, and delegates to existing `plan_bound`. Draft,
slot, schedule, QA binding and original snapshot commit atomically. Caller input
cannot choose actor, slot, policy, draft, schedule or theme. Unknown receipts hold;
no retries or success inference. Legacy unbound enrolled planning is unchanged.

The proposal rolls back and grants nobody runtime access. A reviewed installer
would need ONE additional narrowly scoped EXECUTE grant, never direct access to
`plan_bound` or the raw planner. Existing selector snapshot read is a different
capability and must be counted separately.

The enrolled routes remain unconfigured until authentic reviewed policy,
enrollment, candidate media/quote and runtime configuration exist. The static
legacy worker must not be used for fresh occurrence bindings; use the selected
snapshot worker path after separate composition review. Real API-wallet/rate
verification and automatic owner-authorized enrollment provisioning remain
separate implementation/data requirements. Tests use synthetic data only.
