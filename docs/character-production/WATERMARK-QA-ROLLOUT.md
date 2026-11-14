# Required third-party watermark gate: review plan, not installed

Policy: never publicly publish third-party provider/platform watermarks. Explicitly
authorized ecosystem brand marks remain allowed. This policy does not license
removing a provider watermark contrary to source rights. Use a legitimate clean
export. Do not crop, obscure or relabel the mark as a substitute for permission.

## Exact known rejects
- Ahnika original a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d
- Laviche original ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7
- Laviche provider export70f2ad3fe14420e472908850576b3240bbad2a3e6d121ae2f89a7da77148f4e0
Evidence: owner-selected source hashes mapped to local watermark audit. Ahnika's
separate clean candidate is not auto-approved: sampled clean frames and aligned
audio correlation are not a full-frame/listening review.

## Coordinated implementation needed
1. New ninth `third_party_watermark` check in PROMO_QA, HTTP accepted check list,
   display labels and all readiness counts. No default pass for existing clips.
2. New reviewed SQL migration alters existing QA table check constraint and the
   existing security-definer observation RPC exact allowlist. Preserve actor
   verification, parent row locks, compare-and-swap expected observation,
   revocation trigger and all existing grants. Do not edit historic migration to
   pretend production changed. Actual SQL function definition must be compared
   before replacement. Add actual PostgreSQL tests for pass/fail/unknown/newhash,
   actor revocation, and previous publication consent invalidation.
3. Both candidate review and final delivery must require the ninth exact-media
   observation plus known-hash deny. Apply at final materialize/commit fence, not
   only UI. Read limits currently9 must rise to10 to detect unexpected tenth row.
   SQL prepare/approval/commit routines also contain QA assumptions: audit exact
   production definitions before live rollout; code-only check is insufficient.
4. Website content paths need their own prepublication fence tied to the same
   exact hash/evidence. Social promo gate alone is not site-wide enforcement.
   Already public material and already queued external posts require separate
   inventory/hold/removal, not claims that a future gate retroactively fixes them.
5. UI evidence requires complete clip review, marks observed and authorization
   for any ecosystem mark. Sampling/OCR can flag candidates, never auto-pass.
   Reviewer records truthful coverage; uncertain mark → needs_review.
6. Deploy fail-closed UI/server gate before granting new pass capability. Apply
   reviewed migration in a transaction, verify constraints/grants, then obtain
   real hash-specific review evidence. Existing approvals must be invalidated,
   never copied to replacement media. No generation or publication is authorized
   by installing this gate.

## This tranche
The pure policy is now wired into promo review, delivery, candidate material and
admin readiness code. It is NOT deployed. The reviewed proposal replaces the two
private SQL validators and observation RPC without changing their existing ACLs;
new helper is revoked from runtime roles. A dedicated PostgreSQL17 workflow tests
the proposal over the original eight-check fixture. Existing snapshots remain
invalid without fresh ninth-check evidence.
They reject known marked hashes even with mistaken old passes and reject missing,
failed, duplicate or foreign-media observations. They are not an image detector.
No SQL migration, grant, queue change, approval or public post occurred.
