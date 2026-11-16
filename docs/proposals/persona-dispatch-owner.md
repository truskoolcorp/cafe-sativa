# Caller-bound dispatcher SQL (offline proposal)

This separate sibling proposal adds no route activation, provider calls, credentials, remote actions, or second attempt ledger. The frozen runtime/approval candidates are unchanged. Production schema/grant changes require separate action-time approval, independent review and exact-candidate CI.

## Interface

- `cs_authorize_character_promo_dispatch(p_actor UUID)` is read-only. It atomically reads current strict admin status, enabled owner status and owner revocation epoch, returning `{actorId, actorEpoch}` or null. The backend derives actor from fresh verified authentication, never browser JSON.
- `cs_preflight_character_promo_dispatch(p_actor UUID, p_actor_epoch BIGINT, p_plan_id UUID, p_digest TEXT, p_snapshot JSONB, p_token UUID DEFAULT NULL)` is read-only and returns boolean. Before claim it requires exact current approved content/source/gates/destination, active original approver authority, active caller at the captured epoch, a future target slot exactly representable in whole seconds (no nonzero milliseconds or microseconds), no existing own attempt, and the existing first-claim active-sibling readiness checks. Postclaim it additionally requires the exact same caller/epoch and matching permanent token in submitting state. Scheduled, submission_unknown and legacy unbound tokens cannot authorize a new provider call.
- `cs_claim_character_promo_as_owner(p_actor UUID, p_actor_epoch BIGINT, p_plan_id UUID, p_digest TEXT, p_snapshot JSONB)` locks the existing parent draft, rechecks the same captured caller epoch after any wait, delegates the authoritative existing claim, and binds that newly created token to the caller. It returns UUID or null, never a replacement token for an existing plan.

The private dispatch_time_exact(planId) helper reads the stored exact approval timezone and matching scheduled UTC instant; it has no browser/service execute grant. The provider transport represents whole seconds only and omits a UTC offset. SQL rejects stored scheduled_at values that differ from date_trunc('second',scheduled_at); it never silently rounds or changes an approved slot. It also rejects a local wall timestamp that repeats at UTC offsets of ±30/60/90/120 minutes, using only the approved timezone. This deliberately bounded check blocks both Chicago 2027-11-07T06:30Z and 07:30Z fold instants instead of choosing one; nearby 08:30Z is allowed. It is not a general calendar conversion feature. Before the FIRST claim, the same exact-time check also applies to every active sibling, so a supported target cannot freeze an unsupported sibling. Editing a fractional slot requires a new explicit caption/time review and the resulting consent renewal; withdrawal is a separate explicit alternative.

The dispatcher must carry the originally authorized epoch and original snapshot/digest unchanged through the request. Reacquiring a newer epoch after revoke/restore is not recovery and cannot adopt an old claim. The caller can be a different currently authorized owner from the original content approver, but BOTH authorities remain valid independently. A different active caller cannot adopt another caller's token.

## Schema and privileges

Two nullable metadata columns are added to the EXISTING permanent attempts table: dispatch_actor and dispatch_epoch. Their nullability is paired. Existing attempts remain unbound permanent holds; this proposal does not backfill invented actors, expire attempts, reset state, or create a new ledger.

The proposal revokes service_role execution of the legacy direct claim RPC, granting only the new caller-bound entry point plus the two read-only RPCs. The definer owner still delegates internally. This grant change is a distinct deployment/security gate and requires all activated dispatcher callers to use the new wrapper. Browser roles receive no execute, private tables remain unavailable to service_role, and all definer functions have a fixed pg_catalog search path.

The existing finish RPC is unchanged. An in-flight request can persist an actual receipt or an unknown outcome after authority changes, rather than losing the record of an already attempted external action. Finish cannot create a new claim or authorize another provider call.

## Fail-closed orchestration obligations

No upload, signed-media exposure or provider create request may occur until an acknowledged durable caller-bound token exists. Null/error/timeout/unknown claim responses mean no provider call. A possibly committed claim remains held for manual reconciliation.

Preflight is a read-only check, not an atomic transaction spanning PostgreSQL and external providers. The runtime must refresh caller identity, live canon/rights, actual bytes and exact destination immediately before externally consequential stages, always using the original epoch/snapshot/digest. A failed later check leaves the permanent attempt held; no automatic retry or provider cancellation is implied.

Existing withdrawal, source-freeze, original approver/gate epochs, and future-slot checks remain authoritative. After the first durable shared-draft attempt, an already attempted sibling's elapsed time does not block an independently approved later plan; the target's own future slot still must be valid.

## Verification

Real PostgreSQL 17.11 single-user fixtures check authorization reads, caller versus original approver epochs, exact digest/destination/source binding, permanent uniqueness, same-caller token binding, scheduled/unknown terminal refusal, legacy unbound holds and grant assumptions. Separate fixtures fully approve millisecond and microsecond slots under the preceding ledger, prove the dispatcher rejects them with zero attempts and unchanged stored values, check mixed-precision sibling readiness, and reject both fully approved Chicago fold instants while allowing the nearby nonrepeated instant. The expiry fixture explicitly authors whole-second slots before any review/consent. A final fixture waits for real wall-clock schedule expiry without altering frozen source rows, then verifies preflight denies the still-submitting token and preserves the attempt.

The dedicated hosted fixture prepares actual concurrent caller claims and a request waiting on the parent lock while its caller is revoked/restored. It also verifies authorization/preflight inside READ ONLY transactions and rejects repeatable-read authorization. Those NEW hosted tests are unexecuted; local single-user checks are not concurrency proof.

No denied socket retry or alternate socket/TCP route is used. Local runner initializes fresh candidate-local clusters and invokes postgres --single. Exclude .local-pg-dispatch/ and .persona-dispatch-ci/ from release artifacts.

Production-shape schedule regression: the tests-only persona-production-schedule-overlay.sql replaces the old fixture NOT NULL with the reported nullable timestamptz plus exact cs_character_promo_delivery_schedule_guard CHECK. The null-schedule case exercises actual SQL controls read, withdraw, restore, and explicit caption/time authoring, with final approval/preflight blocked. Actual PostgreSQL plan/draft/QA/control receipts are exported into persona-null-schedule-reader.cjs and passed through the real TypeScript material/controls adapters. No fixture date is invented: null remains null until explicit authoring save. The overlay is never a production migration and does not authorize changing the production guard. CI installs locked Node dependencies with lifecycle scripts disabled for this cross-boundary fixture; it still uses only disposable PostgreSQL and synthetic media, no application secrets.
