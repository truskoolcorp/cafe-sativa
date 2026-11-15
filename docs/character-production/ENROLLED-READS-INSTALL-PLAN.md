# Owner-only scoped reads installation plan (not executable authorization)

Base: `7c710608fc5b9c1fa9d57affb0772f556ee3dce9`.
This plan is offline. Do not paste the source proposals directly into production:
they assume the restricted owner has already been safely established.

## Pinned inputs

- `docs/proposals/character-production-enrolled-queues.sql`
  SHA256 `5dee74d8305f72774e249f951e762fb7de16bf05e2e8aac90771d586b39e2208`
- `docs/proposals/character-production-enrolled-qa.sql`
  SHA256 `b74b0a6de9139aa338a3f900bf68f160f8ea77499107bc8bb33aafd918f6e5de`

Combine only their transaction bodies, in the listed order, inside a single
restricted-owner installer transaction. Do not replace existing raw RPCs.

## Exact changes allowed

Create only these public functions, owned by `character_production_owner`,
SECURITY DEFINER, search_path=pg_catalog, returning JSONB:

1. `character_production_scheduler_due(uuid,text,text,integer)`
2. `character_production_scheduler_pending(uuid,text,text,integer)`
3. `character_production_scheduler_qa_ready(uuid,integer)`

Result ACL for each is owner EXECUTE only. No PUBLIC, service_role, authenticated,
anon, generator, broker or other runtime grant is authorized by this installer.
No table, policy, trigger, row, candidate, schedule or enrollment is created.

## Required atomic installer checks

Use the reviewed scheduler-principal installer bootstrap pattern: PG17 direct
postgres session, restricted NOLOGIN/NOSUPERUSER/NOINHERIT owner, no preexisting
SET/CREATE authority, exact non-self bootstrap membership. Reject unexpected
owner memberships and unexpected inherited effective privileges.

Before temporary authority, require all three target names absent (including
unexpected overloads). Require principal tables owned by restricted owner with
RLS, and the approved source-table RLS/owner baseline. Verify definitions,
SECURITY DEFINER configuration and exact ACL baselines of scheduler_current,
calendar_period, raw due/pending, qa_ready_slots and qa_materialize; these must
be pinned from the exact reviewed predecessor installers, not inferred from
function names alone. A mismatch stops for reconciliation, not replacement.

Lock source and production ledger tables in SHARE mode. Snapshot row multisets,
role attributes, memberships, defaults, schemas, existing relations/columns and
ACLs, existing functions/definitions/ACLs, policies and triggers. Temporarily
self-grant only SET membership and CREATE on public as in the reviewed pattern;
SET LOCAL ROLE restricted owner; execute the two pinned bodies; RESET ROLE and
revoke only those temporary grants using the exact grantor.

Before commit, require identical snapshots and exactly the three expected new
functions with exact source/signatures/configuration and owner-only ACLs. Reject
new tables, triggers, policies, overloads, role changes, leaked authority or
unexpected objects. Statement/lock timeout aborts the entire transaction.

## Disposable PG17 proof required before live review

Build fresh state using the actual existing restricted-owner installers (not a
superuser-only proposal fixture). Test successful owner-only installation,
full rollback, duplicate-install refusal, each missing dependency, dependency
body/ACL drift, elevated-owner baseline and unexpected temporary authority.
Verify rows/ACLs/roles unchanged and all runtime roles unable to execute the new
functions. Then test semantics using temporary grants confined to the disposable
fixture. Existing scoped-queue/QA semantic CI is evidence of predicates only,
not evidence that this new installer or live permissions have been verified.

## Status

Exact source pins, generated installer and restricted-owner fixture prepared.
The PG17 fixture has not yet run; see implementation status below. No live changes.

## Prepared implementation (not yet PG17 verified)

`scripts/prepare-enrolled-reads-install.py` now emits the owner-only transaction,
reusing the pinned predecessor bootstrap and snapshots rather than a looser
superuser path. It verifies dependency bodies from pinned actual installers,
including source-owned `qa_draft_unplanned` and the installed wallet/raw queue.
The scoped QA source now includes the installed unplanned-draft predicate; the
source hash above reflects that correction. The old raw-proposal hash is not the
new install input.

`validate_enrolled_reads_install.py` chains the actual restricted-role predecessor
installer fixture, then tests rollback, successful owner-only install, duplicate
refusal, injected data/identity change, unsafe owner/temporary authority and
missing/drifted dependencies. A separate workflow runs it on disposable PG17.
Generation and Python compilation have passed locally. Actual PostgreSQL proof
is pending CI; no local PG17 executable is available. No live installation.
