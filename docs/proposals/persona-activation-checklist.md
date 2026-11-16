# Persona activation: consolidated local-only checklist

This change inventory derives from the checked-in local proposals. Separate authorized read-only production catalog checks verified the listed PostgreSQL 17.6/builtin prerequisites, proposed-object absences, and nullable schedule CHECK. They did not inspect migration history, function bodies, credentials, effective final ACLs or live activation configuration, and made no production changes. Nothing here authorizes a remote push, schema application, role change, owner provisioning, flag activation, payment, upload, scheduling or publication.

## One explicit production/security approval boundary

The required action-time security approval covers the exact production schema/function/grant changes, auth.users hooks and owner setup below, including legacy claim-grant removal. Permanent owner epochs, attempt uniqueness and audit evidence are retained by design and disclosed here. Code publication and ordinary deployment operations follow their existing authorization; neither they nor runtime flags grant content or private-media transmission consent. Operational backup/access choices may follow existing approved practice rather than requiring a new standalone retention-policy decision.

Keep both runtime flags off through schema/ACL verification and exact-candidate test review. Do not run these CREATE scripts blindly against a database that might already contain some objects: a separately authorized operator must establish existing object state and review the necessary schema/ACL delta. These files are proposals outside auto migrations, not idempotent installers or permission to bypass failed statements.

## Ordered SQL scope

Existing fixture prerequisites; only the specifically listed read-only catalog facts were verified in production, not migration provenance or full behavioral parity:
- `20261020154000_character_canon_spoken_promos.sql`: existing draft/delivery-plan tables.
- `20261020173000_character_promo_qa_checks.sql`: existing eight-check QA table.
- `20261021103000_decouple_promo_script_approval_from_audio.sql`: script approval independent from delivered audio.
- Existing auth.users and anon/authenticated/service_role roles; tested PostgreSQL 17 behavior.

Apply the reviewed proposal delta in this order, with each file's transaction boundaries respected:

1. [persona-delivery-ledger.sql](persona-delivery-ledger.sql)
   - Creates private schema cs_promo_private and owners, approvals, attempts tables.
   - Adds nullable caption to public.cs_character_promo_delivery_plans, with no invented captions or approval backfill.
   - Creates private source_state, guard_source, validate_snapshot functions.
   - Adds source mutation triggers cs_promo_draft_guard, cs_promo_plan_guard, cs_promo_qa_guard.
   - Creates public cs_approve_character_promo, cs_claim_character_promo, cs_finish_character_promo, cs_read_character_promo_approval.
   - Denies private schema/tables/helpers to PUBLIC, anon, authenticated and service_role. Only selected public RPC execution is granted to service_role.

2. [persona-approval-gates.sql](persona-approval-gates.sql)
   - Adds owners.revocation_epoch, approvals.review_generation_id and approvals.approver_epoch.
   - Creates review_versions, review_heads, approval_history and gates private tables.
   - Creates actor_epoch_valid, gate_source_state, validate_gate_content, gate_valid, plan_delivery_ready helpers; replaces guard_source.
   - Creates cs_begin_character_promo_review, cs_confirm_character_promo_gate, cs_read_character_promo_gates.
   - Replaces approval/read/claim logic to require the current generation, three separately explicit gate records, exact content/source state, valid actor epochs, and preclaim active-sibling readiness.
   - Permits explicit preclaim generation replacement and explicit stale final-approval refresh with history preserved; never resets an attempt.

3. [persona-owner-revocation.sql](persona-owner-revocation.sql), explicit additional AUTH/SECURITY scope
   - Creates private invalidate_actor_reviews, prevent_owner_delete, prevent_owner_identity_change.
   - Adds cs_promo_owner_disabled, cs_promo_owner_removed, cs_promo_owner_identity_immutable on the private owner table.
   - Adds cs_promo_owner_admin_lost on auth.users UPDATE OF raw_app_meta_data, only for boolean-admin true→nontrue transitions; the function affects existing persona owners/evidence only.
   - Adds cs_promo_owner_account_removed on auth.users DELETE; unrelated accounts return without persona changes.
   - Owner UUIDs/rows are permanent epoch tombstones: DELETE and identity change are rejected, epoch decreases are rejected. Disable instead. Auth-account deletion remains supported and increments the retained owner's epoch; recreation cannot revive old evidence.
   - Review auth-hook ordering, existing auth triggers/FKs, lock interactions and account-deletion behavior explicitly. Local fixtures have reviewer_id UUID without an auth.users FK; do not assume production parity.

4. [persona-plan-authoring.sql](persona-plan-authoring.sql)
   - Creates plan_edit_reviews and plan_edit_changes_valid.
   - Creates cs_review_character_promo_plan_edit and cs_save_character_promo_plan_edit.
   - Only explicit caption and future UTC time change. Network/account stay immutable. Exact reviewed-state CAS and existing source invalidation apply; no shared attempt permits editing.

5. [persona-plan-withdrawal.sql](persona-plan-withdrawal.sql)
   - Creates plan_controls, plan_control_reviews, plan_control_events; plan_withdrawn and plan_control_cohort helpers.
   - Creates cs_read_character_promo_plan_controls, cs_review_character_promo_plan_control, cs_save_character_promo_plan_control, cs_read_character_promo_plan_control_result.
   - Replaces begin/confirm/approval/read/claim/read-gates and plan_delivery_ready logic to honor explicitly withdrawn targets and cohort membership.
   - Unattempted target withdrawal remains possible after sibling activity without altering frozen source rows. Attempted/unknown targets require reconciliation, never a false cancellation record.
   - Restore is explicit, before any shared attempt only, and requires a new review generation; old consent never revives. A later actor revocation never silently undoes a stop.

6. [persona-qa-observation.sql](persona-qa-observation.sql)
   - Creates cs_record_character_promo_qa_observation; no new table or trigger.
   - Fresh verified content-admin reviewer, exact video hash/draft revision/current observation CAS and existing source guard are required. Recording an observation is not owner QA approval, script approval, voice approval or publication consent.

7. [persona-dispatch-owner.sql](persona-dispatch-owner.sql), explicit additional caller/grant scope
   - Adds paired nullable dispatch_actor and dispatch_epoch metadata to the EXISTING attempts table; creates no second attempt ledger and backfills no invented actors.
   - Creates private dispatch_time_exact with no new grant, reading the exact approved timezone and refusing subsecond or bounded repeated-wall-time representations. Creates read-only cs_authorize_character_promo_dispatch and cs_preflight_character_promo_dispatch, plus cs_claim_character_promo_as_owner.
   - Revokes service_role execution of legacy cs_claim_character_promo. The definer owner delegates internally; all activated callers must use the bound wrapper.
   - The original approval/gate owner epochs AND dispatch caller epoch remain independently required. Old unbound attempts stay held. Scheduled/unknown tokens cannot authorize a new send. Finish remains available to record an actual external outcome after a caller revocation; it grants no new send.

## Final grants and ownership to verify

After the complete proposal stack, these 16 public RPCs have service_role execution, not browser execution:
- cs_approve_character_promo; cs_finish_character_promo; cs_read_character_promo_approval.
- cs_begin_character_promo_review; cs_confirm_character_promo_gate; cs_read_character_promo_gates.
- cs_review_character_promo_plan_edit; cs_save_character_promo_plan_edit.
- cs_read_character_promo_plan_controls; cs_review_character_promo_plan_control; cs_save_character_promo_plan_control; cs_read_character_promo_plan_control_result.
- cs_record_character_promo_qa_observation.
- cs_authorize_character_promo_dispatch; cs_preflight_character_promo_dispatch; cs_claim_character_promo_as_owner.

Verify legacy cs_claim_character_promo is no longer executable by service_role. PUBLIC/anon/authenticated must have no listed RPC execution. Service role must have no direct private schema/table/helper access, must not own these objects or inherit an owner role, and must not bypass the wrapper via another grant. Definer functions must retain fixed pg_catalog search paths and schema-qualified objects. The migration owner must have the reviewed source/auth permissions needed by these functions; unexpected ownership/RLS/grant differences are blockers, not permission to broaden access silently.

## Owner and runtime configuration

- The owner allowlist starts empty. Explicitly approve the existing authenticated user's real UUID before provisioning that owner row; never copy fixture UUIDs or derive owner permission from a browser actor field. Current strict boolean cafe_sativa_admin metadata is independently required.
- The server must get actor from fresh authenticated auth.getUser(). Capture an owner epoch once, preserve it throughout each reviewed action/dispatch, and fail on revocation; never reacquire a new epoch to revive an in-flight request.
- Review runtime flag: CS_PERSONA_REVIEW_RUNTIME_ENABLED must equal the string true. Dispatch additionally requires CS_PERSONA_DISPATCH_ENABLED=true. Neither is set by these proposals. The legacy CHARACTER_PROMO_DELIVERY_ENABLED constant remains false.
- Review-ticket creation, QA observations, plan edits, gate decisions, final approval, withdrawal/restore and dispatch are explicit POST-style actions. GET/prefetch stays read-only. Same-origin/CSRF checks, request-shape validation and fresh authentication remain required.
- Protect server credentials and existing provider connection. No credential creation, refresh, persistent-access expansion or new connection setup is authorized by this checklist.

## Current scope and consent limits

Current mapping is intentionally limited to character keith, intended channel truskoolcorp_metricool_brand_5373515, draft actual_social_account metricool-brand:5373515, Metricool brand 5373515/user 4174093, Facebook account 146219355471397 or Threads account truskoolcorp. This is not authorization for a Café-branded account, another character/network/account, or paid media generation. Mapping expansion requires separate verified configuration, review and user authority.

Before final approval, require actual MP4 bytes/hash, canonical path, full current canonical identity/persona/rights fingerprint, all eight current-video QA checks, explicit script approval, explicit voice/video/publication gates, caption and an exact still-future UTC slot with zero subsecond precision. Provider transport supports whole seconds only and omits UTC offsets: nonzero milliseconds/microseconds must be refused, never silently rounded. Using the exact approved timezone, the bounded ±30/60/90/120-minute repeated-wall-time check must reject both ambiguous fold instants rather than silently choose one. The tested Chicago 2027-11-07 06:30Z/07:30Z fold is blocked; nearby 08:30Z is supported. Before the first claim, all active siblings need supported precision too. Existing fractional slots require explicit reauthoring and renewed consent, or an explicit withdrawal. Do not fabricate timestamps, missing rights, passed QA, or replacement dates. Final delivery approval binds exact content/account/time, and a dispatch request remains a distinct action. Deploying code or enabling flags grants no content consent.

The dispatcher may perform no upload, signed-media sharing or provider create call before an acknowledged durable caller-bound token. Unknown claim outcome means no provider call. Fresh checks immediately before external stages do not form an impossible atomic transaction across PostgreSQL and a provider; subsequent uncertainty must remain held, not retried.

## Retention, reconciliation and rollback

- Retain permanent per-plan attempts, caller binding, immutable consent content/actor/time, generation history, authoring/control review records and cohort events. Operational invalidation flags are not rewritten consent. There is no automatic claim expiration or retry and no cleanup policy in this proposal.
- Existing approved backup/access practice may govern these retained records; no additional mandatory retention-policy decision is invented here. No automated cleanup is included. Do not silently purge evidence, owner tombstones or attempt uniqueness; any future deletion requires its own applicable authorization and must preserve nonretryability.
- Scheduled means a verified provider scheduling receipt, NOT publication. Do not synthesize publication confirmation from an accepted schedule or elapsed time.
- For submitting/submission_unknown/legacy-unbound attempts, inspect persisted evidence and independently verify the provider outcome only under authorized access. Do not resubmit, reset the claim, mint a second plan to evade uniqueness, or pretend cancellation. No automatic terminal-unknown reconciliation mutation is supplied here; any additional reconciliation mechanism needs review while preserving the permanent attempt.
- Unknown review/save responses are reconciled by their immutable review ID. A historical receipt proves that action, not current cohort state; refresh read-only controls and never clear uncertainty from null/mismatched receipts.
- Rollback/incident containment starts by disabling dispatch (and review if needed) through an approved operational action, leaving schema/evidence/holds intact. Disabling flags prevents new requests; it does not guarantee cancellation of a request already in flight, a provider action after its last preflight, or a schedule already created. Caller revocation is checked at preflight, but a change immediately after that check cannot atomically undo an external action. Do not roll back by dropping ledgers, deleting attempts, regranting the unsafe legacy claim path, weakening source freezes or removing owner tombstones. Schema rollback and provider cancellation require separately reviewed actions.

## Evidence required before any activation

Link the exact final commit/tree and full code/typecheck results, genuine PostgreSQL sequential fixture results, all NEW hosted multi-session race/epoch/withdrawal tests, and independent review findings. Earlier bridge/gate CI is not proof for the new runtime/dispatcher stack. The new dispatcher hosted races are currently prepared but unexecuted. Verify rollout/schema assumptions through separately authorized checks, and record explicit owner choices for each actual plan. No production introspection or activation has been performed to complete this checklist.

Further scope details: [review runtime](persona-review-runtime.md), [dispatch runtime](persona-dispatch-runtime.md), [gate generations](persona-approval-gates.md), [withdrawal/cohort](persona-plan-withdrawal.md), [caller-bound SQL](persona-dispatch-owner.md).

## Reported schema drift and disposable parity regression

The reported production scheduled_at is nullable timestamptz with CHECK (((status = 'blocked_assets'::text) OR (scheduled_at IS NOT NULL))) named cs_character_promo_delivery_schedule_guard. The original source fixture had NOT NULL. The tests-only persona-production-schedule-overlay.sql drops that fixture NOT NULL and adds the exact reported CHECK; no proposal alters or deletes the production guard. A blocked null-schedule plan remains readable, withdrawable/restorable, and explicitly caption/time-authorable without inventing a date or granting approval. Final approval and dispatch still require complete explicit consent and a valid future exact time. This is a targeted parity fixture, not proof of all production schema parity. Existing on_auth_user_created presence alone does not establish its body, semantics, or compatibility; do not infer them.
