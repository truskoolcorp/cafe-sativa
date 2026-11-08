# Concierge capability preparation (no migration)

This release prepares the current legacy Café API for a capability-aware Mall
client. It does **not** ship the PR47 durable worker, a ledger, SQL, a migration,
new privileges, a cleanup job, or a production configuration change.

## Wire contract

- `GET /api/concierge/status` returns HTTP 200 with
  `{ "durable_enabled": false, "durable_payload_version": 2, "text_admissions_enabled": true }`
  when both configuration values are unset, empty, or `off`.
- `CONCIERGE_TEXT_MAINTENANCE=on` reports text admissions disabled and rejects
  main text POSTs before body parsing, authentication, quota, database or provider
  work. It does not modify events, watch, video, YouTube or live voice routes.
- This build does not implement durable mode. **Any nonempty durable mode except
  `off`, including `on`, is invalid**: GET and main text POST return HTTP 503
  `policy_unavailable`. Invalid maintenance values also fail closed. An
  environment variable alone can never advertise a missing worker or ledger.
- Capability responses, including errors, carry `Cache-Control: no-store`.
  The status route is also explicitly `force-dynamic` with `revalidate = 0`.
- The existing production origin allowlist is unchanged. Approved Mall and
  preview origins receive explicit CORS for GET, POST and OPTIONS and the
  `X-Concierge-Durable` / `X-Concierge-Requester` headers. Credentials are not
  enabled. Existing special Café aliases remain allowed only on their exact
  same-origin request host. Unapproved origins cannot run route work.
- `POST /api/concierge/status` returns HTTP 503 `status_unavailable` for every
  allowed-origin caller. It does not parse the body or perform authentication,
  database, quota, provider or legacy-history reads. It cannot recover an old
  answer, authorize replay, echo a request identity, or prove a terminal result.
  It sends no `terminal`, `recovery_required` or `admitted` field. Retained
  durable requests must stay retained and must not become new legacy sends.

## Legacy request fencing

Existing legacy callers with no mode/requester headers retain their established
request shape, opaque bounded session IDs, trimming, quota, ownership,
conversation history and reply behavior. No website client change is required.

One intentional legacy safety change is authentication-error handling: the old
route treated every returned auth error as a signed-out guest. Only an explicit
`AuthSessionMissingError` now permits that path. Retryable auth outages and
invalid-token responses return `auth_unavailable` before quota/database/provider
work, including for no-header callers, rather than silently changing identity.

The repaired Mall client reads the capability first, then sends
`X-Concierge-Durable: 0` and `X-Concierge-Requester: guest:<original session>`.
A missing or malformed requester on a fenced request fails before authentication.
A well-formed expectation must match verified authentication and the normalized
original session before any quota or database operation. An auth outage fails
closed rather than being interpreted as sign-out. The expectation is never an
authorization credential.

A durable header of `1` rejects with HTTP 409 `mode_changed`. Other nonempty or
empty malformed header values reject with HTTP 400 `invalid_durable_mode`.
Duplicate/comma-separated mode headers reject. A body containing `request_id` or
`issued_at` also rejects with `mode_changed`, even with a missing or `0` mode
header, so stripping a header cannot silently downgrade retained durable work.
These responses make no claim about an earlier or concurrently running attempt.

## Ordered rollout, requiring separate publication approval

1. Reverify the current upstream main and production commit. Apply only this
   narrow patch to a real GitHub checkout, inspect the diff, and rerun the
   existing concierge CI workflow and ordinary hosted build. Do not replace
   the repository with the partial local verification checkout.
2. Review and deploy this Café capability preparation release first, keeping
   durable mode unset/off. No SQL or permission change is part of this release.
3. Verify the actual public Café capability with the real Mall Origin, its
   no-store headers and CORS preflight. Check denied origins and generic status
   failures without submitting a provider message. Verify all intended Café
   aliases and deployment coverage rather than assuming one public alias
   replaced every older worker.
4. Only after that verified capability is live, deploy the separately reviewed
   Mall client. It must fail closed for missing/404/invalid/5xx capabilities,
   retain uncertain messages, send the correct fences, and never guess legacy
   mode or silently resend. Local route/transport fixtures cannot establish
   public CDN or browser deployment behavior.
5. Keep PR47 durable database activation separate. It still requires its own
   reviewed migration, policy, writer coordination, accounting/drain, retention,
   recovery and operational approvals. This preparation release does not satisfy
   those gates and is not a workaround for them.

Do not roll this legacy-only build over a deployment with unresolved durable
work: it cannot supply durable status or completion, and `off` reopens the
legacy path. A maintenance variable is deployment-local, not a global kill
switch for old deployments or already admitted requests.

## PR47 rebase / merge requirements

PR47 and this change overlap in `app/api/concierge/route.ts`,
`app/api/concierge/status/route.ts`, `lib/cors.ts` and requester policy. Rebase
PR47 on the preparation release instead of copying either version over the
other. Resolve the new status route add/add conflict deliberately.

- Preserve explicit uncached capability, origin restrictions, strict mode/header
  fencing and no-header legacy compatibility.
- Preserve the early maintenance/config gates and requester checks, including
  authentication failures and identity changes before quota/database work.
- Preserve rejection of a body carrying `request_id` or `issued_at` in OFF mode,
  even when its mode header is missing or `0`. Preserve a mandatory requester
  expectation on either fenced `0` or `1` request. Preserve fail-closed auth
  errors in OFF mode too. The existing PR47 candidate is weaker at these three
  points; blindly taking its version would regress this preparation release.
- Keep one version constant and one canonical requester policy. The PR47
  candidate has requester matching in `lib/concierge/request.ts`; reconcile it
  with this preparation helper rather than leaving divergent duplicate rules.
- Replace the hard-disabled availability policy only together with a reviewed,
  deployed and verified worker/ledger. Do not turn the preparation constant into
  `process.env.CONCIERGE_DURABLE_MODE === 'on'` and call that proof of readiness.
- Replace generic status-unavailable only with authenticated, requester-fenced,
  read-only ledger status. No legacy-history fallback may grant replay. Missing
  rows, old SQL, unavailable policy or unverified terminal states must remain
  fail-closed, and the database must authorize every replay of the exact body.
- Run the preparation regressions together with PR47's full durable and
  isolated database suites after resolving conflicts. Update preparation-only
  off-build assertions intentionally when the durable engine is actually
  integrated; do not disable the safety assertions to make a merge pass.

## Local validation and limits

The new regression uses the real policy, request parser, persona, ownership,
history, origin rules, CORS and NextResponse implementations. Only actual I/O
boundaries are replaced with counted synthetic fixtures. Rejections assert zero
auth-client creation, auth, database/admin creation, quota, canonical-content,
event, memory, provider and write calls as applicable. Status also asserts zero
body reads and no replay/terminal/admission grant or request-content echo.

Run the existing CI command from the repository root:

```
node --test tests/concierge*.cjs tests/conversation*.cjs tests/hit-em-premiere.test.cjs tests/lounge-membership.test.cjs
npx tsc --noEmit --incremental false
```

The existing CI wildcard already includes `tests/concierge-capability.test.cjs`.
These tests do not contact a live model or database and do not prove production
availability, durable readiness, cross-deployment draining or browser/CDN
behavior. They do not create credentials, alter permissions, push, migrate,
merge or deploy anything.
