# Durable text concierge database tests

These files target a **new disposable synthetic PostgreSQL database only**. They do not call a provider, deploy, or use application credentials. Never run them against a shared application DB. CI targets official PostgreSQL 17.6 and 17.11 images. Neither image is the exact Supabase PostgreSQL 17.6.1.104 build.

Full integration run (requires installed `psql`):

```sh
CAFE_DISPOSABLE_DB=1 PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres \
PGDATABASE=cafe_durable_test PGPASSWORD=synthetic_local_only \
python3 tests/db/run.py --bootstrap
```

The host must be loopback or a local Unix socket. All supplied credentials must be disposable local fixtures. Database names are restricted to `cafe_durable_test` and `concierge_isolated_test`; inherited libpq override variables are cleared. `--bootstrap` requires an empty DB and the isolated `postgres` owner. Without it the exact candidate migration and bootstrap must already be installed. The runner applies four transactional SQL fixtures, then real multi-connection races. Races retain synthetic ledger entries in the disposable DB; recreate the DB before rerunning.

## Coverage

- `bootstrap.sql`: disposable schema fixture, never an application migration. Includes all **49 FK edges** found in the read-only production catalog snapshot on November 8, 2026, including the complete discovered `auth.users → profiles → host_conversations → host_messages` path, auth session/MFA/OAuth branches, commerce references, SET NULL branches, and NO ACTION/RESTRICT blockers. FK names and deletion actions match that snapshot. Auth tables belong to a non-superuser, non-BYPASSRLS `supabase_auth_admin`; public tables/functions belong to `postgres`. Auth admin has no direct public-table or private-schema rights; service role has no auth-table DML rights. The fixture models the existing profile-creation, timestamp and message-count triggers, and uses the checked-in lounge paid-period guard.
- `durable_concierge.sql`: state machine, admission validation, owner/token checks, local completion/retry, uncertain dispatch/deletion, same-ID expiry, partial completion rollback, tier/global caps, privacy and permissions.
- `roles.sql`: actual `SET ROLE` anon/authenticated denial and service-role admission/dispatch/completion/status under RLS. Profile presentation edits remain usable.
- `full_auth_deletion.sql`: actual `DELETE auth.users` under auth-admin role, all seeded auth cascade leaves, SET NULL updates and their timestamp triggers, redaction of completed/reserved/uncertain ledger content, retained charged state, and ten distinct NO ACTION/RESTRICT blockers. Tests assert the specific failing constraint and exact rollback of ledger/cache/conversation/message/profile/SET NULL rows.
- `durable_lifecycle.sql`: bounded request issuance/replay, retention, compaction, pruning and uncertainty tests. All changes roll back.
- `run.py`: separate sessions queued behind a global-lock barrier. Existing races cover duplicate IDs, last requester/global inflight/window/budget slots, simulated lost acknowledgment, dispatch/completion and direct profile deletion. New races cover coordinated full-auth deletion versus explicit/new-conversation admission, dispatched completion, seven writer mutations (voice-style message insertion, message edit/delete, conversation end, profile identity update, profile-reference insertion and auth-reference insertion), plus NO ACTION deletion failure competing with admission/completion. Cleanup races cover same-ID replay/pruning, policy expansion after pruning, expired completion, terminal evidence and new admission while dispatched work remains uncertain. Every contender must be observed waiting in `pg_locks` before the barrier releases; otherwise the test fails rather than claiming a race pass. Outer statement and lock timeouts are explicitly bounded.

SQL fixture helpers generate UUIDv7 IDs and derive `issued_at` from their first 48 bits. Each SQL fixture uses a single transaction timestamp, so reconstructing a payload preserves its issuance across retries. Python derives issuance directly from the same retained UUID. No duplicate retry silently mints a fresh key or timestamp.

## Important lock-order limitation

The new **positive** auth-deletion races model an explicitly coordinated deletion transaction: acquire `pg_advisory_xact_lock(1128351301,1)` before `DELETE auth.users`, using the auth-admin role. Writers mixing auth/profile references and concierge operations acquire that same transaction lock before their first write. This requires no auth-schema trigger or auth-admin private-schema grant.

The runner also contains a deliberate **negative** test: a raw auth deletion takes the auth tuple lock before its profile cascade requests the global lock, while a global-first orders writer requests an auth FK lock. A deadlock or lock timeout and atomic rollback are expected. Passing this negative test documents an unsupported lock order; it does **not** establish that arbitrary production deletion/writer paths are safe.

A usable, authorized deletion entry point and every participating writer must still be identified and coordinated before activation. Replacing an Auth API call with direct SQL is not automatically equivalent: the reviewed path must preserve the service’s account lifecycle and any storage/external cleanup checks. A separate transaction that merely takes/releases the lock before calling the hosted Auth API does not coordinate the Auth API transaction. No production auth trigger, deletion RPC, auth-admin privilege expansion, or Auth API modification is installed by this suite. Other transactions that lock unrelated dependent rows before entering concierge remain outside the proven coordinated protocol.

## Fixture and verification boundaries

This is **not an exact production-schema export**. It reproduces the discovered FK graph, relevant ownership/RLS posture and trigger effects with abbreviated synthetic row shapes. Several real key types are represented as UUIDs. Unrelated columns, checks, indexes, auth internals, extension behavior and most RLS policies are omitted. The lounge function comes from the repository, not a newly verified production body export; no claim is made about external clients, scheduled jobs or actual GoTrue deletion behavior. The synthetic postgres bootstrap owner can be a local superuser, whereas the cataloged production postgres role is not; tested auth deletion itself runs as the restricted auth-admin role and uses RI owner switching for public cascades.

A PostgreSQL **single-user** execution validates parser/runtime/sequential assertions and `SET ROLE` behavior only. It does **not** prove real concurrent locks, service authentication, PostgREST routing, the hosted Auth API or deployment readiness. The full runner requires sockets or CI. A mocked JS RPC pass does not substitute for these database tests. Verification must name the exact candidate digest/head and distinguish sequential checks from a successful hosted race run.
