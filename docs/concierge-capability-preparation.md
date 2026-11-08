# Concierge capability and durable reconciliation

This combined source incorporates PR47's durable worker and immutable request
ledger contract with PR48's capability guards and local font build repair.
It is a local reconciliation candidate, not an activation or production-ready
claim. No configuration, policy, credentials, privileges, deployment or database
state is changed. Durable mode still defaults to OFF.

## Capability and admission policy

One runtime policy module, `lib/concierge/capability.ts`, owns the payload version
and the durable/text-maintenance gates. `lib/concierge/request.ts` owns the single
canonical requester validation and matching policy. Headers fence expectations;
verified server authentication always selects the actual requester.

- Unset, empty or `off` durable mode advertises `durable_enabled: false` and
  payload version2. Explicit `on` describes the integrated durable worker. Other
  nonempty values fail closed. This advertises configured code capability, not
  proof that its database, policy or operational prerequisites are satisfied.
- Text maintenance `on` blocks main POSTs before body parsing or any external
  work. Invalid maintenance values also fail closed. Already admitted work may
  still complete, and status remains readable with replay suppressed.
- Malformed/duplicate/comma-separated mode headers reject before I/O. Mode0
  against ON rejects503 `mode_changed`. Mode1 against OFF rejects503
  `durable_disabled`. Neither response claims an earlier or concurrent attempt
  was not admitted. Original request identities must stay retained.
- In OFF mode, any body property named `request_id` or `issued_at`, including
  null or malformed values, rejects409 `mode_changed` even with no mode header
  or mode0. Retained work is never silently downgraded to a legacy send.
- Explicit mode0 or mode1 requires a valid requester fence. A malformed fence
  rejects before auth. A well-formed mismatch rejects before admin, quota,
  database or provider work. No-header legacy callers remain compatible.
- Unexpected Auth errors fail closed in every mode, including unfenced OFF
  callers. Only `AuthSessionMissingError` permits normal guest resolution.
- Main and status responses are no-store. Status is force-dynamic with
  `revalidate = 0`. Existing origin allowlist and credentials-free CORS remain
  unchanged. Preflight permits the required GET/POST and requester/mode headers.

## Deliberate resolution of the status route add/add conflict

PR48's preparation-only status implementation could never access a ledger.
The combined route uses PR47's authenticated, exact-payload ledger status while
preserving PR48's no-store, dynamic, CORS and early requester validations. In
OFF mode and maintenance it may return a previously committed response, but
must not grant admission replay. It never calls a provider or reads legacy
history as a substitute. Missing or unavailable SQL fails closed; no response
claims a terminal outcome without the existing ledger's explicit evidence.

Only the existing database-authorized MISSING or recoverable reservation flow
in ON mode with maintenance OFF permits replay, using the byte-identical
retained body and UUID. No code refreshes an old issuance time or invents a
replacement identity. Existing v1 payload hashes and v2 UUIDv7 timestamps,
deletion fencing, tombstone lifetimes and rejection-watermark behavior remain
unchanged. See [the durable contract](concierge-durable-client.md),
[cutover runbook](concierge-cutover-runbook.md), and
[database design](../supabase/DURABLE_CONCIERGE.md).

The first-install migration now incorporates the separately reviewed numeric
cleanup/ACL hardening and retained-row ceiling. See
[the combined safety candidate](concierge-combined-safety.md) for its exact scope
and remaining gates. It is no longer the original PR47 SQL. No schedule or
production policy values are selected.

## Verification and publication limits

Run the combined concierge/font suite and TypeScript check:

```
node --test tests/concierge*.cjs tests/conversation*.cjs tests/hit-em-premiere.test.cjs tests/lounge-membership.test.cjs tests/site-fonts.test.cjs
npx tsc --noEmit --incremental false
```

The launch workflow retains both isolated PostgreSQL17.6/17.11 jobs and the
isolated Auth-service job, plus all added font and route/transport coverage.
Offline harness tests do not replace running those integrations for the final
combined head. Transport tests use a byte-identical pinned copy of the reviewed
Mall transport with only external I/O replaced, and do not prove browser/CDN
behavior or a deployment's actual configuration.

Apply only the reviewed patch/file manifest to a current complete checkout.
Do not replace a repository with a partial local verification snapshot. Verify
upstream heads and conflicts again, run exact-head CI and a full hosted build,
then separately review preview behavior and permitted rollout. No push, merge,
deployment, live SQL, provider spend or activation is authorized by this file.

Production activation remains gated on the reviewed live migration/privileges,
actual provider quotas and gateway timeout, explicit capacity/retention policy,
coordinated Auth deletion/writers, legacy text drain across reachable workers,
cleanup/reconciliation operations and controlled acceptance. OFF reopens the
legacy path; do not treat it as a global kill switch or drop outstanding durable
work. Keep compatible status/completion available while draining. The local font
fix does not modify these requirements or enable durable admission.
