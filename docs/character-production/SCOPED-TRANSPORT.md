# Scoped transport and private output broker (not activated)

`character-production-scoped.ts` is an internal adapter library, not a route,
credential factory, migration or scheduler. No live database/storage/provider is
called by tests. Existing production runtime remains unchanged/disabled.

## Separate trust domains

1. A dedicated generator DB session receives only authorization, claim, submitted,
   unknown, pending, failed and due EXECUTE rights. The code uses fixed SQL names
   and parameter-bound values. No arbitrary RPC, SQL, role switching, output
   attestation, QA or publication capability is exposed.
2. An isolated output broker gets output_status/output rights and narrowly scoped
   immutable Storage insert + exact readback. Generator sends bytes/job identity,
   never receives broad Storage keys or signed bearer upload URLs.
3. QA ingestion and release remain separate; successful storage is pending QA,
   never owner approval or published content.

This supersedes the earlier plan's generator output RPC grants **for deployments
using this broker**, not existing deployments. An application allowlist alone is
not a database permission boundary: independently verify the actual restricted
role grants, inheritance, defaults and authenticated transport before enabling.

## Why proxy rather than signed upload

The installed `@supabase/storage-js` StorageFileApi `createSignedUploadUrl` signs
path/upsert; `uploadToSignedUrl` accepts a supplied file body. It does not expose
an expected SHA-256 binding. Therefore merely signing `{digest}/{sha}.mp4` does
not prove uploaded bytes match that name. The broker instead hashes bounded MP4
bytes, validates authoritative job/token via output_status, checks private bucket
metadata, uploads without overwrite, verifies exact bounded readback, rechecks
trusted authority and only then attests output. An uncertain insert is not retried;
it may only be reconciled with matching readback. A previously committed receipt
also requires byte readback. It never returns raw backend errors or credentials.

## Required before wiring (not provided by this library)

- Provision separate authenticated DB sessions with least-privilege grants; the
  injected query contract can use a verified driver, not user-controlled SQL.
- Build an authenticated server-to-server broker boundary. Do not expose the
  broker dependencies or accept unverified caller-supplied authorization results.
- Implement broker `authorize(job)` against current trusted immutable job/slot,
  approved digest and intended scope. Decide/document revocation and expiry for
  already-paid job collection. Fail closed on unavailable authorization. This is
  deliberately not a guessed RPC name or a permissive default.
- Supply actual Storage metadata/insert/bounded-read adapters with private bucket
  and job-bound path policies. INSERT-only, no overwrite/delete/list/public URL.
- Driver and Storage adapters must bound each operation and disable automatic
  write retries. The library does not pretend Promise.race cancels remote writes.
- Confirm current role/trigger compatibility; isolate broker secrets outside the
  generator process. No `SUPABASE_SERVICE_ROLE_KEY` shortcut.
- Rehearse SQL and Storage negative tests with actual restricted identities,
  including wrong job/token/digest, cross-path read, overflow, revoked slots and
  conflict/timeout behavior. Unit tests are not evidence those policies exist.
- Review/wire `createBrokeredProductionStore` explicitly; current runtime is not
  silently changed. Authorize exact real slot/cost separately and inspect output.

No guarantee of atomic revocation across Storage and SQL is claimed. Authorization
is rechecked before upload and output attestation; unavoidable cross-service races
need a reviewed deployment policy. Retain orphaned private evidence for
reconciliation, never blindly retry paid work or erase reservations.

## Additional unmounted boundary tranche

`character-production-broker-boundary.ts` now supplies an unmounted HTTP handler
factory: POST-only fixed path, separately injected server-to-server bearer token,
constant-time token digest comparison, authentication before reading bytes,
bounded headers/body/chunks/deadline, and in-process overlap rejection. It accepts
binary MP4 plus exact `x-character-job` JSON and `x-content-sha256`; this is our own
internal wire format, not a provider API. Never log those headers (job token is
private). Responses are no-store and do not expose backend errors. It returns
held/false rather than instructing retries. The process guard is NOT a distributed
lock or restart-persistent receipt; DB identity and immutable paths remain required.

The Storage adapter reuses the repository's verified streaming Supabase read
interface and immutable upload API. It validates hash-bound path and MP4 bytes.
Upload timeout is an uncertain outcome, not cancellation or permission to retry.
Metadata and reads are bounded by the existing QA adapter. SDK transport must
still disable automatic retries and forbid upload redirects at configuration time.

`character-production-broker-authorization.sql` defines the exact new read-only
security-definer function used by `createBrokerAuthorization`. It checks the
immutable job/token/provider/task/binding identity against enabled exact approved
slot and permits only submitted/pending-QA jobs. It intentionally fails closed on
expired authorization, including already-paid work; changed collection policy
requires explicit review. The proposal grants nothing and has NOT been applied.
It must be included in isolated PostgreSQL role/negative tests before rollout.

Still absent: actual role provisioning, broker secret provisioning/authenticated
HTTPS mounting, production SQL installation, Storage policies, session/SDK
instances and scheduler wiring. DB queries need bounded driver configuration.
The handler bounds request ingestion, not total backend duration: do not deploy
with unbounded dependency adapters. Passing unit mocks does not establish live
role or private-storage enforcement.

## Explicit brokered runtime wiring

`createBrokeredCharacterProductionRuntime(config, open)` now composes the same
canonical authorization, live avatar/voice inventory, provider validation and
engine with `createBrokeredProductionStore`. `open` takes `outputBroker` instead
of `storage`; thus generator code does not receive a direct Storage client. The
ordinary factory is retained for backward compatibility, but is not selected for
scoped deployments. Neither factory activates without explicit matching config;
null/default and explicit-disabled inputs never open clients.

A deployment must place the private broker and its DB/Storage credentials in a
separate service boundary; injecting an in-process object with broad credentials
is not isolation. The remote OutputBroker client is intentionally not implemented
until the approved HTTPS deployment URL/authenticated transport is known. No
route, cron, environment or provider configuration was changed by this wiring.

Broker authorization also requires the exact provider/period budget remain enabled
and match the approved slot cap. Disabling budget therefore holds collection as
well as new generation. The isolated PostgreSQL CI suite exercises these checks,
slot revocation, expiry, modified snapshots and every identity field; it applies
only to its explicitly disposable local synthetic database.
