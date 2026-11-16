# Disposable PostgreSQL validation

These reconstructed tests use real PostgreSQL 17 with synthetic roles, policy, jobs and drafts. Never point them at a production database or shared cluster. Fixtures create cluster-wide roles, so use a **fresh isolated cluster**, not merely a fresh database on a shared server. Schema proposals are not deployment approval.

## Serial standalone tests

Use official PostgreSQL 17 binaries, Python 3, and a fresh stopped cluster. The scripts require explicit paths and do not start a listener:

```sh
export PG_BIN_DIR=/path/to/postgresql/17/bin
export PG_BIN="$PG_BIN_DIR/postgres"
export PG_DATA=$(mktemp -d)
"$PG_BIN_DIR/initdb" -D "$PG_DATA" --no-locale -A trust
python3 tests/postgres/validate_ledger.py
python3 tests/postgres/validate_qa_bridge.py
python3 tests/postgres/validate_qa_trigger.py
```

The ledger suite tests transactional install/rollback, hostile inherited role grants, immutable slots, exact provider bindings, task uniqueness, output compare-and-set/idempotence, shared-budget caps, no refunds for unknown/failed jobs, expiry/current UTC month and revoke/restore revisions. The QA suite tests exact target, microsecond timestamp, byte/hash and destination binding; media/approval/script guards; policy drift; bounded queue; receipts; and absence of approval or publication writes.

The trigger fixture was recaptured using read-only `pg_get_functiondef` on 2026-11-11. It contains SQL logic only, with no credentials or customer rows. Tests install the captured function on synthetic dependent tables and verify READ COMMITTED, review invalidation without approval grants, and atomic rejection of a draft frozen by a prior delivery attempt. This is not a full production-schema replica or a Storage-byte test.

Successful transcripts are generated under `evidence/postgres-*-validation.log`. Each suite prints PASS only after its assertions succeed. No paid provider call, production mutation, storage upload or publication occurs.

## Concurrent local or CI tests

The original execution environment prohibits sockets. Concurrent tests have **not run there**; serial results do not certify interleavings. Use the workflow result and generated concurrency evidence, not source presence, as proof of success.

```sh
export PG_BIN_DIR=/path/to/postgresql/17/bin
export PATH="$PG_BIN_DIR:$PATH"
export PG_DATA=$(mktemp -d)
export PGHOST=$(mktemp -d)
export PGDATABASE=character_ci_local
export PG_DISPOSABLE_TEST_CONFIRM=yes
"$PG_BIN_DIR/initdb" -D "$PG_DATA" --no-locale -A trust
"$PG_BIN_DIR/pg_ctl" -D "$PG_DATA" -l "$PG_DATA/server.log" -o "-k $PGHOST -h '' -c unix_socket_permissions=0700" -w start
trap '"$PG_BIN_DIR/pg_ctl" -D "$PG_DATA" -m fast -w stop' EXIT
"$PG_BIN_DIR/createdb" "$PGDATABASE"
python3 tests/postgres/validate_concurrency.py
```

The harness requires an explicit local Unix socket or loopback host and disposable database name. It runs all three serial suites via server connections, then observes real lock waits through `pg_stat_activity` before releasing competing transactions:

- Same key: exactly one claim/job/reservation.
- Different keys sharing insufficient budget: one succeeds, cap remains intact.
- Expiry while waiting on a budget lock: no claim or reservation.
- Slot and budget revocation while waiting: no claim or reservation.
- Target changed after actual QA prepare, while commit waits: neither draft changes and no receipt appears.

Connection, statement, lock, idle-transaction and subprocess waits are bounded. Child clients are terminated on exit. Lock readiness requires a server-observed marker after lock acquisition, not stdout buffering. Actual month rollover while blocked is not simulated; serial wrong-month rejection is tested. Always stop the disposable cluster after a run.

`.github/workflows/character-production-postgres.yml` defines path-scoped pull-request/manual execution on an ephemeral local PostgreSQL 17 service, read-only repository permissions, disabled persisted checkout credentials and a ten-minute limit. Its password is synthetic, used only for that service. No application/provider/production secrets are required. The tests themselves do not launch CI or publish repository changes.
