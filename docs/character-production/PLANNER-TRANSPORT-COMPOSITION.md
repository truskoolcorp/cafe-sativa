# Dormant planner policy transport and tick composition

These additive modules register no route or cron and enable nothing.

- `createPlannerPolicySource` invokes only the new read-only
  `character_production_planning_policy(uuid)` RPC, with retries disabled and the
  validator's AbortSignal. It accepts only exact, current, enabled policy data.
- The separate SQL proposal exposes a narrow policy projection to its restricted
  owner only. It grants no runtime role access. `owner_evidence.evidenceRef` must
  contain a real approved evidence reference; no existing policy is invented,
  seeded, or migrated by this proposal.
- `createPlannerScheduler` opens nothing when disabled. A tick reads at most one
  candidate from its trusted internal source, then invokes the planner at most
  once. It has a finite deadline, propagates cancellation, and marks ambiguous
  planning outcomes held rather than retrying. SQL still owns cross-tick dedupe.

## Verification

22 new tests pass; all 64 planner-related tests pass. Focused strict TypeScript
passes. The new policy-read SQL has not yet been executed in disposable PG17.

## Remaining real integration gaps

There is no trusted candidate-store transport or exact binding transport yet.
The binding reader must resolve the approved portrait/audio references, canonical
revision, provider binding revision, rights/theme approval, and current exact
quote from authoritative existing records. A boolean or manifest supplied by a
request body is not sufficient. No such production manifest/schema is invented
here. The scheduler must compose that reader, the existing canon reader,
`createPlannerValidator`, policy transport and existing planner using a reviewed
restricted backend identity. Grants and policy enrollment require a reviewed
installer and tests. Wallet/claim checks, media QA, watermark checks, social
approval and actual publication receipts remain separate required stages.
