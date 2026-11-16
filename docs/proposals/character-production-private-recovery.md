# Finite pre-provider text recovery (offline)

The original immutable preparation occurrence claimed its text phase, then source
readiness failed before a text-provider attempt was admitted. The original flag
must never be reset. This proposal adds one separately authorized recovery claim,
not a new daily key, budget, speech retry, or automatic successor.

## Boundary

- One singleton recovery ledger references the exact existing occurrence/budget.
- Same daily key, 10-cent total cap, Haiku rate ceiling, and midnight Dallas sunset.
- No recovery if any provider attempt exists for that key or budget, or any budget
  amount is reserved. Admission serializes on the existing budget lock.
- One monotonic claim; expiry, identity, audit references and claim cannot reset.
- Existing source validation, downstream unique provider claim, receipt persistence,
  abort/drain behavior and same-origin admin checks remain in place.
- Recovery only creates private text. Original speech flow subsequently consumes
  its exact persisted identity and retains included-credit/overage safeguards.
- No video, publishing, editorial approval, or recurring activation.

## Installation and rollout

SQL is a default-ROLLBACK proposal, not an applied migration. New SECURITY DEFINER
functions and their exact service-role EXECUTE grants require separate action-time
approval. No direct runtime table privileges or caller-supplied scope are added.
Effective indirect runtime-role principals must be reconciled before approval.

Keep every preparation/recovery switch off during installation. Deploying code
alone provides no recovery authority. Verify canonical readiness read-only, original
occurrence unchanged, zero attempts/reservation, finite scope, exact privileges,
and original provider work drained before enabling the finite test. Reconcile each
phase before continuing; never repeat an uncertain request. Disable switches and
drain immediately after the bounded test. A claimed/expired recovery is retained
as audit evidence, never deleted or renewed.

## Rollback

Before transaction commit, rollback leaves no objects or permissions. Afterward,
turning the dedicated recovery switch off prevents new app execution; approved
revocation of its two RPC grants closes backend access without deleting evidence.
Never drop or rewrite the original/recovery/provider ledger as rollback.
