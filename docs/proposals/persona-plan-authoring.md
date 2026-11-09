# Offline caption/time authoring proposal

This proposal depends on the separately reviewed delivery ledger, approval gates and owner revocation proposals. It is not an auto migration. No production installation, owner registration, routes/worker activation or provider operation is authorized by these files.

## Reviewed-before-save protocol

1. Fresh server authentication supplies `p_actor`; never use an actor supplied in request JSON. Server must independently restrict this feature and authenticate each review and save request.
2. Call `cs_review_character_promo_plan_edit(p_plan_id,p_caption,p_scheduled_at,p_actor)`. Caption must be nonblank and at most 500 PostgreSQL characters. Time must be a real canonical UTC timestamp `YYYY-MM-DDTHH:mm:ss.sssZ` more than 60 seconds in the future. Existing null captions and past schedules are valid source state. No media, QA, canonical-rights or delivery-readiness requirement is imposed at authoring.
3. Display the proposed caption, UTC schedule and immutable destination from the returned snapshot. Keep the complete `{snapshot,digest}` unchanged as internal review state. Changing inputs discards the displayed review. Review records contain exact prior plan/draft rows, actor epoch, proposed values and a random review ID. They neither begin approval generations nor approve anything.
4. On a separate explicit Save, freshly authenticate and call `cs_save_character_promo_plan_edit(p_snapshot,p_digest,p_actor)` with that exact review. Do not regenerate a review/digest or refresh its source state during Save. Digest uses PostgreSQL built-in `sha256(convert_to(snapshot::text,'UTF8'))`, hex-encoded. No extension is required; JavaScript stringification is not equivalent.
5. Save compares the exact stored review, current owner/admin/epoch, entire expected plan and draft under the shared parent draft lock, and absence of every attempt for every plan in the shared draft. Only caption and scheduled_at are assigned. Success returns `{planId,caption,scheduledAt,consentInvalidated:true}`. A single-use saved_at records the change; exact replay is refused even for no-op proposals.

Normal conflicts/invalid review values return SQL null. Missing current owner/admin authority and non-READ-COMMITTED isolation raise fixed errors. HTTP adapters must return sanitized generic conflict/forbidden responses, never raw SQL diagnostics, private source records or auth metadata. Snapshot is opaque internal client review state, not a human-readable dump.

The existing plan source trigger invalidates consent across the draft and preserves generation, gate and approval evidence. Historical approval timestamps are unchanged and cannot confer current consent. A successful Save is not readiness, review approval, delivery approval or a scheduling/provider operation. Review records are append-only except one saved_at stamp, with no service-role table grants. Retention and cleanup need separate audited lifecycle design; no cleanup is authorized here.

## Immutable scope and siblings

promo_id, character_id, network, account_id, status, receipts, creation timestamps, draft fields and all other plan columns remain unchanged. The proposal cannot create, delete, exclude, retarget or automatically approve any sibling. Unwanted sibling plans can still block aggregate claim readiness. Resolving them requires a separately reviewed and explicitly authorized lifecycle proposal with evidence and claim-safety rules.

## Offline validation

`tests/sql/run-persona-authoring-single.py` creates a new disposable PG17 cluster and uses only `postgres --single`; no listeners, socket connections, network, credentials, provider calls or production data. It installs existing fixture migrations and frozen proposals unchanged, then the new authoring proposal and focused SQL assertions. Real PG17 validates built-in digest, null-caption/past-schedule editing before QA, exact noneditable fields, draft identity, tampering, single use, stale plan/draft, epoch revoke/restore, invalid dates/values, shared sibling claims, evidence invalidation/preservation, restrictive grants, admin/owner denial and isolation denial.

This single-session suite does not certify concurrent lock races. Before any production consideration, independent review and an approved isolated multi-session fixture must test save/save, save/claim and first-authority/revocation races, including save after a blocked parent lock, followed by deployment-specific grants/trigger/schema review. Explicit production database/security/deployment approvals, owner setup, external facts and activation remain separate.

## Proposed hosted CI wiring (not dispatched)

`.github/workflows/persona-runtime-proposal.yml` adds actual `pull_request` triggers with exact proposal, fixture, migration and harness input paths. Caption/time authoring and exact-hash QA have separate jobs and fresh PostgreSQL 17 service containers. They must not share one cluster: both harnesses create initially absent roles. Health probes explicitly use `pg_isready -U postgres -d postgres`.

`tests/sql/run-persona-authoring-ci.sh` runs the assertion suite, then separate disposable databases for save/save, genuine claim/save, save/genuine claim, owner revocation/save before approval evidence, and stale-draft/save. Its barrier requires the first transaction to hold its lock while sleeping and observes the second session actually waiting on a lock; sequential execution cannot pass as a race. `persona-authoring-claim-seed.sql` establishes real generation, three gates and final approval through the proposal RPCs, not forged claim evidence. The QA job uses the existing `run-persona-qa-ci.sh` for observation CAS, media replacement and admin revocation races.

Locally, shell parsing and workflow structure/path checks passed. The authoring assertion suite and the new genuine claim seed, successful claim, and authoring-caused claim rejection also passed in PG17 single-user mode. Neither hosted workflow nor either multi-session harness was invoked or published. Their actual concurrent outcomes remain unverified until an approved CI run; no local listener or socket workaround was attempted.
