# Isolated GoTrue service acceptance

This job runs the **official `supabase/gotrue:v2.197.0` service and its real HTTP
API** against a new disposable `postgres:17.6` database. It closes the gap between
the separate direct-SQL concurrency suite and an actual Auth-service transaction.
It is not a claim of complete hosted Supabase parity or permission to change a
live Auth schema, account, role, configuration or deployment.

## Running and isolation

The `isolated-auth-service` job in `.github/workflows/concierge-launch-gate.yml`
runs this automatically for relevant pull requests or an authorized workflow
dispatch. It needs no repository secrets or deployment environment. The only
runtime entrypoint is:

```sh
bash tests/auth-service/run-ci.sh
```

The script requires `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`,
numeric run/attempt identifiers and `CAFE_DISPOSABLE_AUTH=1`. It intentionally
does not provide a local socket fallback. The script validates the Compose
configuration, pulls only the two official version-pinned images, records their
resolved image digests, and starts a unique project named from that CI run.
PostgreSQL data lives in container tmpfs. Cleanup is restricted to that project.
Existing containers in the same project cause refusal rather than reuse.

Both services use a Docker **internal** network with no normal external egress
and **no published ports**. Docker does not publish ports for containers attached
only to internal networks because there is no default-gateway network. On the
Linux GitHub host, the runner instead reaches the private container IPs directly.
`isolation.py` discovers them from local Docker metadata and verifies the current
run's exact Compose ownership labels, pinned image names, running state, one
internal bridge, private subnet, distinct matching addresses, no published
bindings, no additional networks and exactly the two expected network members.
It accepts no environment-supplied or guessed host/URL. Failure of any check
stops acceptance before an Auth or SQL request. No external network or proxy is
added to make the service reachable.

All credentials are fixed disposable test values. No application `.env` is read
or mounted. The Python runner replaces all inherited libpq settings, uses only
the verified private endpoints on container ports `5432` and `9999`, disables
HTTP proxies and redirects, and allows only its explicit Auth endpoints. Emails use `example.invalid`, email signup
auto-confirms, and SMTP points to an unusable loopback port. No email, SMS, OAuth,
payment, LLM or other external provider is contacted.
The isolated service's email/OTP/token/verify rate limits are raised explicitly
for the fixture volume; they do not describe or alter hosted project limits.

Failure diagnostics show owned container state and fixed startup event names
(migrations applied, API listening port, configuration/connect/migration failure,
or error details withheld). Raw logs are captured privately, classified and
never echoed. Environment values, database connection strings, access/refresh
tokens, passwords and arbitrary Auth response bodies are not emitted. The runner retains full synthetic rows only in memory to compare
transaction rollback. Do not add raw request/response logging.

## Fixture boundary

1. `init-roles.sql` creates empty roles and the Auth namespace. The Auth database
   owner is a login-enabled, non-superuser, non-BYPASSRLS role. It has no direct
   public-table write privileges. Schema creation is allowed only in this
   disposable database, following the upstream development bootstrap pattern.
2. The official GoTrue default command runs its own embedded migrations before
   serving. This suite does **not** create abbreviated Auth tables or replace
   their types, constraints, indexes, functions, lifecycle or audit behavior.
3. `public-bootstrap.sql` supplies the abbreviated public Café fixture from the
   separate database suite. Its public FK graph, public RLS flags and relevant
   triggers are modeled; it is still **not a full production public-schema
   export**. The signup hook uses the read-only cataloged `handle_new_user()`
   body: insert `(new.id, new.email)` into profiles with `ON CONFLICT DO NOTHING`.
   Its owner, SECURITY DEFINER setting, empty search path and execute ACL match
   that observation. The Auth-owned `auth.uid()` implementation is not replaced.
4. The suite loads the shared `tests/db/commerce_bootstrap.sql` columns and exact
   original commerce bodies in `tests/db/commerce_functions.sql`, then installs
   the exact candidate migration. The migration's original-body/security/ACL
   guards still have to pass. No commerce body is copied into this directory.
5. Every Auth user, identity, session and refresh token is created through real
   HTTP signup/admin/password-token endpoints. Every soft or hard Auth deletion
   goes through `DELETE /admin/users/{id}`. Direct SQL handles public fixture
   setup, actual Café RPC calls, observations and assertions only. There is no
   SQL Auth-deletion fallback.

The real Auth schema includes the service's other branches, but this acceptance
job actively seeds only the email/password lifecycle. It does not claim to test
MFA, OAuth, SAML, WebAuthn, SCIM, Supabase Storage ownership checks, gateway or
PostgREST behavior, hosted configuration, or every public column/policy. The
separate `tests/db/` suite covers its larger synthetic FK graph and SQL races.
Official PostgreSQL 17.6 is not the hosted Supabase 17.6.1.104 build.

## Acceptance coverage

- Verify `/health` returns exactly `v2.197.0`, a populated Auth migration catalog,
  correct table ownership and no Auth-admin access to concierge private objects
  or lock helpers. Record the actual PostgreSQL version, candidate SHA-256 and
  Auth migration count/latest version/catalog SHA-256 alongside image digests.
- While holding the global lock in a test-only barrier, real signup, password
  sign-in, token refresh, metadata update and Auth soft deletion must complete.
  Each operation uses a fresh barrier and verifies it still owns the lock after
  the HTTP response, before releasing it.
  Profiles receive the signup email, and soft deletion removes sessions without
  being mistaken for the hard-delete cascade.
- Race actual Auth hard deletion with explicit-conversation admission and true
  new-conversation insertion, in both verified queue orders. Also race it with
  completion after a synthetic dispatch marker, in both queue orders.
- Observe the **actual `supabase_auth_admin` backend executing DELETE** waiting
  on the installed advisory lock. A scheduled HTTP future alone is not evidence
  of overlap. Every contender must be observed before a barrier is released.
- In the inversion regression, an ordinary admission transaction holds only its
  own real locks. Auth HTTP deletion must wait before its auth tuple lock, then
  the same admission transaction must successfully insert an Auth-referencing
  order and commit. There is no manually added lock around the Auth API.
- Verify hard deletion removes real users/identities/sessions/refresh tokens,
  cascades profiles/conversations/messages, clears public SET NULL branches,
  redacts concierge content and preserves dispatched charges. Admin lookup and
  refresh fail after deletion. The database deletion audit must be present.
- A public NO ACTION blocker must make the actual API fail atomically: complete
  Auth/public/ledger snapshots and the **database** audit count remain unchanged.
  The default Auth API error format must report HTTP 500 with PostgreSQL code
  `23503` for FK/RESTRICT blockers. A two-second lock-timeout failure must instead
  report HTTP 500 with `unexpected_failure` and gets the same snapshot checks.
  After removing only
  the synthetic blocker/releasing the lock, retrying the actual API succeeds.
  This makes no claim that external Auth log messages are rolled back.
- Actual gallery payment, free/paid ticket reservation, ticket payment and
  authenticated Lounge author/moderator deletion RPCs hold their own transaction
  locks while the Auth API is observed waiting. Verify buyer SET NULL, artist
  RESTRICT, paid reservation/moderator NO ACTION, inventory/receipt idempotency,
  and nonowner Lounge denial. These commerce/Lounge tests force writer-first
  overlap; the separate SQL suite has broader competing-order coverage.

The test-only policy is explicitly enabled with synthetic capacities/costs to
exercise admission. No real provider dispatch occurs. Production policy and
rollout approvals remain separate.

## Offline validation and honest reporting

These checks run without Docker, servers, network requests or credentials:

```sh
python3 -m unittest discover -s tests/auth-service -p 'test_*.py' -v
python3 -m py_compile tests/auth-service/*.py
bash -n tests/auth-service/run-ci.sh
```

Offline tests cover endpoint/credential isolation, proxy/redirect rejection,
runtime gating, real HTTP deletion routing, no direct Auth DML/schema fallback,
required backend/wait evidence, synthetic JWT generation, safe error reporting,
the exact signup hook, pinned internal Compose configuration, Docker-owned
endpoint validation, rejection of external/mixed/mismatched topology and safe
startup-log classification. They validate
the harness; they do **not** prove that the containers start or that service
acceptance passes. Report a service pass only after this job succeeds on the
exact candidate commit and reports its migration digest. A missing image,
startup/migration/configuration error, missing observed wait or failed assertion
fails the job. Do not replace it with a mocked success or another Auth version.

The first service CI attempt on `dd866ddb` failed before any API lifecycle test:
containers were running, but host loopback `/health` was refused. The original
internal-only Compose topology relied on ineffective published ports. The
direct-private-address design was verified in CI on `5249b3a1`: GoTrue v2.197.0,
PostgreSQL 17.6 and 75 official Auth migrations started successfully. The lifecycle
bypass checks, both admission/completion race orders and FK inversion regression
passed. That run then stopped on an incorrect harness expectation: a public FK
error is returned as code `23503`, not the generic `unexpected_failure`, by this
tagged service's default API version. The assertions now require the exact code
for each scenario. Full acceptance still requires a successful new CI run.

## Official version-pinned sources

- [Official image publishing destinations and version tags](https://github.com/supabase/auth/blob/v2.197.0/.github/workflows/publish.yml).
- [Image command and packaged migrations](https://github.com/supabase/auth/blob/v2.197.0/Dockerfile).
- [Default command runs migrations before serving](https://github.com/supabase/auth/blob/v2.197.0/cmd/root_cmd.go)
  and [embedded migration runner](https://github.com/supabase/auth/blob/v2.197.0/cmd/migrate_cmd.go).
- [Initial embedded Auth migration, including auth.uid()](https://github.com/supabase/auth/blob/v2.197.0/migrations/00_init_auth_schema.up.sql).
- [Upstream PostgreSQL role/schema bootstrap](https://github.com/supabase/auth/blob/v2.197.0/hack/init_postgres.sql)
  and [configuration example](https://github.com/supabase/auth/blob/v2.197.0/example.env).
- [Admin hard/soft deletion transaction](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go)
  and [database audit behavior](https://github.com/supabase/auth/blob/v2.197.0/internal/models/audit_log_entry.go).
- [Configuration definitions](https://github.com/supabase/auth/blob/v2.197.0/internal/conf/configuration.go)
  and [HTTP error response versions](https://github.com/supabase/auth/blob/v2.197.0/internal/api/errors.go).
- [Default API PostgreSQL error-code mapping](https://github.com/supabase/auth/blob/v2.197.0/internal/utilities/postgres.go).
- [Exact signup/user/token rate-limit configuration mapping](https://github.com/supabase/auth/blob/v2.197.0/internal/api/apilimiter/apilimiter.go).

- [Docker internal-network semantics and host-to-container access](https://docs.docker.com/reference/cli/docker/network/create/).
- [Moby maintainer explanation of internal-only port publishing and direct Linux-host access](https://github.com/moby/moby/discussions/53256).

Sources establish the intended configuration and transaction path. Image pull,
startup and actual runtime evidence are deliberately left to the isolated CI job.

## Combined local candidate

The ordinary Auth-service bootstrap explicitly configures a synthetic retained
ledger cap of 10000 through the shared DB helper. This is fixture-only, not an
application capacity decision; the migration retains its NULL fail-closed default.
All existing Auth HTTP, commerce, writer-order and denial checks remain in place.
The additional combined cap/cursor races run in the separate disposable direct-SQL
job, not by changing Auth's API or granting Auth access to private helpers.
Preparing these fixtures and running their offline tests does not establish actual
service or concurrent acceptance for this combined candidate; the pinned disposable
CI services must still run successfully before that claim can be made.
