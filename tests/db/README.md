# Durable text concierge database tests

These files target a **new disposable synthetic PostgreSQL 17 database only**. They do not call a provider, deploy, or use application credentials. Never run them against a shared application DB. The bootstrap intentionally creates roles and production-shaped minimal tables, including profile cascading deletion, message counts, RLS, and broad service-role default privileges.

Full integration run (requires installed `psql`):

```sh
CAFE_DISPOSABLE_DB=1 PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres \
PGDATABASE=cafe_durable_test PGPASSWORD=synthetic_local_only \
python3 tests/db/run.py --bootstrap
```

The host must be loopback or a local Unix socket. All supplied credentials must be disposable local fixtures. Database names are restricted to `cafe_durable_test` and `concierge_isolated_test`; inherited libpq override variables are cleared. `--bootstrap` requires an empty DB. Without it the exact candidate migration must already be installed. The runner applies the two transactional SQL fixtures then runs real multi-connection races. Races intentionally retain synthetic ledger entries in the disposable DB; recreate the DB before rerunning.

- `bootstrap.sql`: minimal isolated fixture, not an application schema migration.
- `durable_concierge.sql`: state machine, admission validation, owner/token checks, local completion/retry, uncertain dispatch/deletion, same-ID expiry, partial completion rollback, tier/global caps, privacy, permissions.
- `roles.sql`: actual anon/authenticated denial and service_role admission/dispatch/complete/status execution under RLS.
- `run.py`: separate PostgreSQL sessions queued behind a global-lock barrier, testing duplicate IDs, last requester slot, global inflight/window/budget slots, known-success/same-ID retry (a simulated lost acknowledgment, not a transport fault), concurrent dispatch/completion, profile-cascade/admission and lock timeout. Every contender must be observed waiting in `pg_locks` before the barrier releases; an unqueued contender fails the test rather than weakening it. Connection-level statement timeout is explicitly configured.

A PostgreSQL single-user execution of plain SQL files validates parser/runtime/sequential behavior only. It does **not** prove actual concurrent locking, PostgreSQL service role authentication, PostgREST routing, or hosted deployment readiness. The full runner and its races require sockets or CI. A mocked JS RPC pass does not substitute for these database tests.
