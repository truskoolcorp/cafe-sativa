# Post-QA publication target (source proposal only)

Generation due time and social publication time are different facts. Existing
immutable scheduler candidates keep their generation due time and slot digest.
This proposal does not reschedule or replay an introduction or alter a delivery
plan. Legacy scopes without a cadence retain their exact prior behavior.

For a new explicitly owner-enrolled standing publication scope, provision a
`publication_cadences` row with America/Chicago, one to four reviewed local times,
minimum lead (300–3600 seconds), and maximum horizon (3600–86400 seconds). No rows
or runtime grants are supplied here. Cadence rows are immutable; revoke the linked
standing scope to stop use. Disabled cadence never falls back to legacy timing.

The narrow `cs_resolve_cafe_publication_target(p_draft)` accepts no actor, timestamp,
policy, destination, or QA assertion. It rechecks current owner standing scope,
actual generation membership, admin authority, completed current-video QA rows and
approval timestamps, then derives the next permitted future time. Its immutable
record binds original enrollment, manifest hash, slot digest, scope and due time.
Existing delivery plans prevent initial target creation. Reconciliation returns
only the same still-future target. A missed target holds; it is never rewritten.

`publication_current` uses the separate target only for explicit cadence scopes;
all existing current policy, future timestamp, exact destination and expiry checks
remain. The target is not semantic approval, a delivery plan, a provider receipt,
or proof of publication. The existing authority writer still checks all exact QA,
source state and fresh semantic evidence. No owner policy is manufactured.

## Actual caller integration boundary

Current `schedule-preview` and `character-promos` routes are read-only. Existing
`cafeEditorialFromPlan` and `createCafeStandingServer.record` require plans that
already exist. No recurring trusted delivery-plan insert composition exists in
these paths. The serial preparation implementation must call the target resolver
AFTER actual QA and BEFORE inserting new exact FB/IG delivery plans, using retained
trusted text metadata. A separate narrow atomic delivery-plan writer remains
necessary; do not add raw table access or mutate preview routes as a shortcut.
Existing plan reconciliation must not regenerate speech/video or recreate posts.

## Access and validation

The proposal is owner-context SQL ending ROLLBACK. It adds two private owner-only
tables, one private helper and one owner-only public resolver. Existing generation
membership gains `slotDigest`; existing publication authorization gets only the
exact timing substitution. Both function bodies are pinned to reviewed MD5 values.
New resolver EXECUTE and owner-provisioned cadence/scope rows require separate
review before runtime use. No new cross-owner raw table grant is added. Any future
service-role EXECUTE must disclose the existing indirect Storage-admin role path.
The PG17 fixture uses synthetic data only; it cannot prove provider delivery.
