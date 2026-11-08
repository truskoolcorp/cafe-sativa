# Combined first-install safety candidate

Local candidate only. No migration, privileges, production settings, schedule,
provider calls, publication or deployment is authorized by this document.
Durable mode remains OFF. The private policy starts disabled, with material
settings NULL, including the new retained-row ceiling. The real private schema
must still be absent when the separately approved first installation occurs.

## What is combined

The reconciled durable/capability/transport/font source is unchanged. Its
first-install SQL now combines a numeric cleanup cursor, exact private-object
ACL/role/default checks, and an owner-selected retained-row ceiling. The five
new public RPCs and owner-only Auth trigger helper also get exact final ACL,
owner, INVOKER and settings checks; public-schema default privileges must not
silently add recipients or grant options. Existing commerce ACLs are pinned by
the original source/security preconditions and are not rewritten. No role or
default privilege configuration is silently repaired.

Identity and policy columns are in CREATE TABLE, not an existing-ledger upgrade.
Do not apply this file to an existing concierge_private schema, append the old
separate ALTER proposals, or treat an advisory lock before live-table DDL as a
safe upgrade protocol. Drain ordinary writers and use bounded DDL/session
timeouts in the approved installation plan. All original Auth, Lounge,
profile, conversation, message and commerce writer guards remain.

## Retained-row admission ceiling

max_retained_requests is a nullable bigint with no default. NULL rejects new
rows as policy_unavailable. At/over the selected ceiling, new rows fail as
capacity_busy. The BEFORE INSERT row trigger counts every live ledger state
under the existing global transaction lock. The admission handler catches only
PCB01/PCB02 and rolls back its entire attempted body before returning these
errors, including newly created conversations and opportunistic expiry writes.

Existing-key recovery, conflict checks, status, completion and evidence-based
finish precede or avoid INSERT and remain available when the ceiling is NULL,
full or lowered. Cancelled/refunded, completed and redacted rows still consume
a slot. Unknown dispatch is retained and charged indefinitely until terminal
evidence permits resolution; capacity must not be freed by unsafe deletion.
Direct service INSERT and multirow INSERT share the guard. A direct duplicate
UPSERT can be denied before conflict resolution at capacity; the public RPC
performs its existing-key lookup first and does not have that limitation.

The exact count is O(min(live rows, ceiling)), inside the shared lock. Earlier
separate synthetic measurements around 20–24 ms at 100,000 compact warm rows
are context, not performance evidence for this final candidate, production
throughput, latency percentiles or a chosen ceiling. Dead tuples, larger rows,
cold reads and contention can cost more. This caps live ledger rows, not bytes,
WAL, bloat, conversation history, denied ingress or retries. A missing cleanup
job leads to admission denial rather than unlimited live-row growth.

## Numeric cleanup and privacy

An immutable GENERATED ALWAYS bigint identity and unique index supply sweep
order. Only the original request columns are service-writable; sequence and
identity privileges remain owner-only. The lifecycle stores two bigint markers,
cleanup_scan_after and cleanup_scan_through, with no requester or request key.
A new sweep snapshots a finite upper identity; later appends cannot prevent it
from wrapping. Each call inspects at most the explicit batch size, including
ineligible rows. Numeric gaps and sequence consumption on rollback are allowed.

Lifecycle transitions and prune criteria are unchanged. The rejection floor,
heartbeat, row changes and cursor markers commit or roll back together. Only
terminal, redacted rows beyond captured/current retention and the full
24-hour accounting horizon can be pruned. Unknown work is never pruned or
refunded to make space. Owner-only maintenance has no new service EXECUTE,
DELETE, lifecycle UPDATE, credential, role or SECURITY DEFINER path.

Finite sweeps are not a deletion deadline. A nominal cycle is
ceil(ceiling / batch size) times cadence, plus lock/retry/wrap overhead; a row
becoming eligible just after its visit may wait another cycle. No values or
cadence are selected here. Tombstone requester/key fields remain personal data.
Ledger redaction does not erase existing conversation history, satisfy all
account-erasure requirements or authorize indefinite identifier retention.

## Exact-candidate CI plan and remaining decisions

1. Run the unchanged focused client/route/font suite, TypeScript and offline
   harness tests. Run the aggregate suite and compare any failures with the
   verified main baseline, without suppressing failures.
2. In the existing disposable PostgreSQL 17.6 and 17.11 CI jobs, run whole
   first-install modeled rejection/rollback checks, pristine install/catalog
   assertions, cap/privacy/sweep fixtures and the five original SQL suites.
   Defensive modeled metadata tests do not create actual rogue grants/roles or
   recreate escalation/delegation/identity-injection/deletion proofs.
3. Run the independent-session fixtures in tests/db/combined_races.py, observing
   actual advisory-lock waits for contenders and both holder outcomes. They
   cover last-slot RPC/direct/multirow contention, saturation recovery,
   rollback/timeouts, maintenance/append/replay, cursor rollback and prune
   release. Offline Python tests certify fixture structure only, not outcomes.
4. Preserve and run the real isolated GoTrue 2.197.0 Auth job plus existing
   commerce/Lounge/writer races. Verify hosted PostgREST/Auth roles, default
   privileges, timeouts, prepared callers, full schema and rollback/restore in
   a separately approved rehearsal. No old PR CI result certifies this tree.
5. Complete exact-head hosted build, browser/CDN/alias QA and client rollout.
   Publishing the migration-bearing tree must not silently trigger an
   unapproved database integration.

Before activation an operator must choose the ceiling and rejection behavior,
arrival/latency targets, ingress and fairness controls, storage/vacuum alerts,
retention/privacy policy, cleanup execution privilege/cadence/service objective,
provider quota/budget/timeouts, uncertain-dispatch owner and evidence retention.
Legacy drain, privileged installation, live settings and controlled provider
acceptance each remain separately approval-gated. Keep compatible status and
completion available while paused; switching durable mode OFF can reopen the
legacy path and is not a global kill switch.
