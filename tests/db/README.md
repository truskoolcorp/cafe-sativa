# Durable text concierge database tests

These files target a **new disposable synthetic PostgreSQL database only**. They do not call a provider, deploy, or use application credentials. Never run them against a shared application DB. CI targets official PostgreSQL 17.6 and 17.11 images. Neither image is the exact Supabase PostgreSQL 17.6.1.104 build.

Full integration run (requires installed `psql`):

```sh
CAFE_DISPOSABLE_DB=1 PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres \
PGDATABASE=cafe_durable_test PGPASSWORD=synthetic_local_only \
python3 tests/db/run.py --bootstrap
```

The host must be loopback or a local Unix socket. All supplied credentials must be disposable local fixtures. Database names are restricted to `cafe_durable_test` and `concierge_isolated_test`; inherited libpq override variables are cleared. `--bootstrap` requires an empty DB and the isolated `postgres` owner. Without it the exact candidate migration and bootstrap must already be installed. The runner installs the synthetic schema and exact original commerce RPC bodies, tests migration drift rejection, applies five transactional SQL fixtures, then runs real multi-connection races. Races retain synthetic ledger entries in the disposable DB; recreate the DB before rerunning.

## Coverage

- `bootstrap.sql`: disposable schema fixture, never an application migration. Includes all **49 FK edges** found in the read-only production catalog snapshot on November 8, 2026, including the complete discovered `auth.users → profiles → host_conversations → host_messages` path, auth session/MFA/OAuth branches, commerce references, SET NULL branches, and NO ACTION/RESTRICT blockers. FK names and deletion actions match that snapshot. Auth tables belong to a non-superuser, non-BYPASSRLS `supabase_auth_admin`; public tables/functions belong to `postgres`. Auth admin has no direct public-table or private-schema rights; service role has no auth-table DML rights. The fixture uses the verified existing profile-creation body (id/email insert with conflict ignored), models timestamp and message-count triggers, and uses the checked-in lounge paid-period guard.
- `commerce_bootstrap.sql` and `commerce_functions.sql`: abbreviated additional commerce columns and exact read-only catalog definitions of the three existing checkout RPCs plus the Lounge soft-delete RPC. Original body hashes are recorded; the candidate must pass its source/security/ACL preconditions before it can revise those functions. No provider is called or external payment synthesized.
- `auth_integration.sql`: normal Auth-owner signup/session reference/metadata/modeled soft-delete update and authenticated profile presentation edits succeed without acquiring the global lock. Raw Auth DELETE and identity UPDATE acquire the installed statement guard with no auth-admin private access or helper execute grant; existing commerce RPC security and client denial remain unchanged.
- `durable_concierge.sql`: state machine, admission validation, owner/token checks, local completion/retry, uncertain dispatch/deletion, same-ID expiry, partial completion rollback, tier/global caps, privacy and permissions.
- `roles.sql`: actual `SET ROLE` anon/authenticated denial and service-role admission/dispatch/completion/status under RLS. Profile presentation edits remain usable.
- `full_auth_deletion.sql`: actual `DELETE auth.users` under auth-admin role, all seeded auth cascade leaves, SET NULL updates and their timestamp triggers, redaction of completed/reserved/uncertain ledger content, retained charged state, and ten distinct NO ACTION/RESTRICT blockers. Tests assert the specific failing constraint and exact rollback of ledger/cache/conversation/message/profile/SET NULL rows.
- `durable_lifecycle.sql`: bounded request issuance/replay, retention, compaction, pruning and uncertainty tests. All changes roll back.
- `run.py`: separate sessions test duplicate IDs, last requester/global inflight/window/budget slots, simulated lost acknowledgment, dispatch/completion and direct profile deletion. Raw Auth-admin deletion races explicit/new-conversation admission, dispatched completion, five guarded writer mutations and NO ACTION rollback. Actual gallery payment, ticket reservation/payment and authenticated Lounge author/moderator soft-delete RPCs compete with raw Auth deletion, preserving inventory/idempotency, buyer SET NULL and artist/reservation/moderator RESTRICT/NO ACTION behavior. A nonowner Lounge deletion remains denied without altering the target. Direct membership upsert/update and order insert/update are overlapped in **both** transaction orders using their ordinary statements, without adding locks. A regression holds the lock through a real admission entrypoint, observes raw Auth DELETE waiting, then successfully writes an auth FK from that same real transaction, proving DELETE has not already acquired the auth tuple. Cleanup races cover same-ID replay/pruning, policy expansion after pruning, expired completion, terminal evidence and new admission while dispatched work remains uncertain.

Global-lock races require every contender to be observed waiting in `pg_locks` before releasing a test-only barrier. Ordinary standalone FK writers need no global lock; their overlap helper instead requires the second transaction to be blocked by the first actual writer backend using `pg_blocking_pids`. The holder adds no lock beyond its real statement. A missing wait fails rather than claiming a race pass. Outer statement and lock timeouts are bounded. The `as_role` and `auth_delete` helpers never acquire a coordination lock.

Before candidate installation, the runner independently changes an original checkout function's body, SECURITY DEFINER setting, execute permissions, configuration and existence. Every variant must be rejected with the expected drift error, leave no concierge schema/statement guards behind, then restore the original fixture. This checks atomic rollback, not just the presence of a hash expression.

SQL fixture helpers generate UUIDv7 IDs and derive `issued_at` from their first 48 bits. Each SQL fixture uses a single transaction timestamp, so reconstructing a payload preserves its issuance across retries. Python derives issuance directly from the same retained UUID. No duplicate retry silently mints a fresh key or timestamp.

## Installed coordination and limits

The candidate's lock-only `public.concierge_auth_statement_v1()` is SECURITY INVOKER, uses an empty search path, and directly invokes only the built-in transaction advisory lock with a two-second lock timeout. Its execute privilege is revoked from client/service/Auth-admin roles. PostgreSQL's installed triggers can still invoke it; no Auth-admin private-schema or public-table DML grant is added. It runs before raw `auth.users` DELETE, auth identity UPDATE and Lounge UPDATE row locking. Normal signup, Auth metadata/soft-delete updates and profile presentation edits remain outside this lock.

The three existing service-only commerce RPCs enter the same lock before their first `FOR UPDATE`; their original bodies, owners and ACLs are checked before replacement. The tests exercise those actual function definitions, not simplified wrappers which manually acquire the lock. Single membership/order statements remain unmodified; their FK locks must settle without a deadlock against the guarded deletion.

This replaces the prior negative raw-deletion inversion test with a positive regression for the installed guard. The suite does **not** replace an Auth HTTP request with SQL in the application or claim direct SQL performs all Auth service lifecycle/storage checks. A separate lock transaction before an Auth HTTP call would still provide no coordination. The activation review must separately retain the service-source and deployed-version evidence. Transactions which take an unrelated lock first and only later enter a guarded path remain outside this protocol unless separately reviewed. No live Auth trigger, provider request, role change or schema change is performed by running this disposable suite.

## Fixture and verification boundaries

This is **not an exact production-schema export**. It reproduces the discovered FK graph, relevant ownership/RLS posture and trigger effects with abbreviated synthetic row shapes. Several real key types are represented as UUIDs. Unrelated columns, checks, indexes, auth internals, extension behavior and most RLS policies are omitted. Commerce columns reproduce only the tested RPC paths, and the fixture has the installed pgcrypto extension for ticket redemption code generation. The lounge function comes from the repository, not a newly verified production body export; no claim is made about external clients, scheduled jobs or actual GoTrue deletion behavior. The synthetic postgres bootstrap owner can be a local superuser, whereas the cataloged production postgres role is not; tested auth deletion itself runs as the restricted auth-admin role and uses RI owner switching for public cascades.

A PostgreSQL **single-user** execution validates parser/runtime/sequential assertions and `SET ROLE` behavior only. It does **not** prove real concurrent locks, service authentication, PostgREST routing, the hosted Auth API or deployment readiness. The full runner requires sockets or CI. A mocked JS RPC pass does not substitute for these database tests. Verification must name the exact candidate digest/head and distinguish sequential checks from a successful hosted race run.

## Local combined-candidate additions (not yet concurrent acceptance evidence)

The combined candidate starts with `max_retained_requests=NULL` and therefore
fails closed for new ledger inserts. The harness supplies **10000 only as an
explicit synthetic test setting**, after first-install/fail-closed tests, without
choosing an application capacity or changing the migration default. The five
original transactional fixtures remain unchanged. Standalone executions must
supply the synthetic cap before their ordinary policy configuration; invoking
`run.py` does this automatically. The Auth HTTP harness supplies the same explicit
synthetic ceiling through `db.configure`.

Before pristine installation, `combined_install_checks.verify` exercises modeled
metadata faults in whole migration transactions and checks rollback fingerprints.
These are defensive installation checks, separate from ordinary role/race/Auth
acceptance. They do not grant the modeled permissions or create exploit roles.
After pristine installation, `combined_install.sql`, `retained_backlog.sql`,
`retained_backlog_extra.sql`, `cleanup_privacy.sql`, `cleanup_sweep.sql` and
`isolation_contract.sql` run
before the original transactional suite.

After the original concurrent suite, `combined_races.py` adds:

- Four service RPC contenders for one retained-row slot, and service RPC versus
  ordinary old-column service INSERT for one slot.
- Two competing two-row service INSERT statements with only three slots,
  requiring one complete winner and zero rows from the losing statement.
- Saturation with existing status, same-ID replay, local completion and expired
  reservation recovery still usable; finishing a row alone does not free storage.
- A real service INSERT transaction holding the last slot, observed contenders,
  holder rollback, and an actual lock-timeout failure followed by successful retry.
- Maintenance held after its first one-row batch versus new service INSERT and
  same-ID replay, then bounded cursor batches racing the same replay through
  pruning. The fixed numeric boundary excludes the appended row, the cursor must
  advance and wrap, the pruned key stays expired, and the freed slot admits a new
  request without increasing the cap. Reverse ordering holds a real INSERT while
  maintenance waits.

The new holder uses no extra advisory lock. Every contender must be observed in
`pg_locks` waiting for the actual holder's advisory lock tag in this database.
Missing waits fail. Startup reads, idle transactions, SQL statements and process
waits have outer bounds. SQLSTATE assertions reject contextual matches and
unrelated failures. Test INSERTs omit the generated identity column, use existing
service permissions, and never directly delete ledger rows or grant access.

The existing workflow already discovers offline harness tests and invokes the
full runner, so no workflow or schedule changes are necessary. Offline tests
exercise SQL construction, explicit fixture configuration, strict error matching
and mocked holder/wait cleanup; they do **not** prove PostgreSQL race outcomes.
No listeners, database connections, Auth calls, CI dispatch or deployment were
run while preparing these additions. A future authorized disposable CI run is
required to accept the new concurrent cases against the exact candidate digest.
