# Dormant unattended planner authority: implementation review

Offline proposal, not production installation or activation. No real enrollment,
credential, grant or candidate manifest has been created. PostgreSQL17 CI must
pass before readiness; only Node tests, Python compilation and focused TypeScript
have been run locally.

## Existing authentication primitives

`lib/content/auth.ts:cronAuthorized` authenticates the existing CRON_SECRET bearer
header with a timing-safe comparison. It does not authenticate a user UUID.
`isContentAdmin` resolves an interactive session with auth.getUser and checks
server-controlled app metadata. The genuine source-owned
`cs_cafe_metricool_is_admin(uuid)` boolean checks current server metadata but alone
does not authenticate its caller. The canary internal-entry pattern supplies a
flag/auth/open boundary; its expired canary is not reusable enrollment.

## Implemented SQL contract

`character-production-scheduler-principal.sql` adds three restricted ledger-owner
RLS tables, no runtime policies or grants:

- `scheduler_enrollments`: immutable policy revision/full policy snapshot, actor,
  complete candidate snapshot, reviewed manifest hash, owner evidence reference,
  approval and expiry. Only irreversible disable is allowed after insertion.
- `scheduler_candidates`: exact immutable slot/digest/draft/theme/time by ordinal,
  at most 32 ordinals. Every guard compares the complete ordered set to the sealed
  snapshot. Later INSERT invalidates authority rather than expanding it.
- `scheduler_binding`: singleton named `cafe-character-planner` binding. Runtime
  cannot choose any other active enrollment by guessing its UUID.

All context/reconcile/write wrappers call `scheduler_current`: policy then
enrollment lock, current singleton binding, exact policy/candidate snapshots,
current admin, enabled/revision/expiry checks. Enrollment expiry cannot exceed
policy expiry. Candidate time must be at/after approval and before enrollment
expiry; numeric slot authorization expiry must be after candidate time and no
later than enrollment expiry. CASE guards malformed values before numeric casts.

Enrollment disable revokes all its approved slots, schedules and QA bindings.
Binding disable, removal or retarget disables its old enrollment and triggers the
same downstream revocation. This prevents future eligibility, not cancellation of
already submitted provider work. No immutable history is silently rewritten.

Public functions (all SECURITY DEFINER, fixed pg_catalog, PUBLIC revoked):
- `character_production_scheduler_context(uuid)` resolves current actor and exact
  candidates; policy projection comes from the actual policy reader and includes
  actual opaque ownerEvidenceRef, not full private owner evidence.
- `character_production_scheduler_reconciled(uuid,integer)` delegates the stored
  candidate to the existing exact planned_draft boolean.
- `character_production_scheduler_plan(uuid,integer,jsonb)` derives actor, slot,
  digest, time and policy from storage, accepting only server validation evidence.
  It calls the existing atomic planner. No caller actor or arbitrary slot override.

The existing planner validates evidence shape and canonical/binding digests.
Fresh canon/rights evidence is still a trusted server assertion, NOT independent
proof against a compromised service-role process. Manifest hash is a reviewed
owner-provisioned identity marker, not an automatically verified signature over
all private media. Real provisioning must establish that provenance explicitly.

## Runtime adapter and future permission delta

`character-production-planner-scoped-adapter.ts` maps exact reviewed planner calls
to the three wrappers, snapshots records and verifies context's complete candidate
projection, actor, manifest hash and policy ID/revision. It rejects caller changes,
unknown RPCs, retry, cancellation and stale context. It registers no route/cron.

Future reviewed permission expansion is EXECUTE on only these three signatures
to existing service_role, never raw plan/policy/planned_draft, tables, auth, helpers
or role membership. Proposal grants none. The disposable fixture alone tests this
delta. Existing service-role remains broad infrastructure trust, not a newly narrow
credential. No new secret/copy is needed; never put CRON_SECRET into SQL/evidence.

A future handler must authenticate cron before constructing the adapter or opening
storage/provider reads, use a current reviewed enrollment, and reject request
actor/candidates. SQL derives and checks actor again at write time. Revocation
locks serialize against an in-flight plan; one authorized transaction may finish
before revoke commits, but subsequent writes must fail. Admin revocation uses
statement-snapshot semantics, not new direct auth row-lock privileges.

## Validation status

Eight scoped adapter tests pass, including stale schedule/policy/candidate
mismatches. Focused strict TypeScript and Python fixture compilation pass.

The genuine installer-chain disposable PG17 fixture now covers:
- absent/unbound enrollment; exact scoped grants/no raw access;
- positive synthetic enrollment, real owner reference/no private evidence leak;
- later INSERT changing sealed set; current admin revocation; wrong digest;
- distinct rolled-back enrollment expiry/time/malformed authorization negatives;
- three concurrent planners, one creation and no reserved/spent funds;
- binding disable/delete downstream revocation and concurrent revoke/write;
- no successful write after revocation commit.

These PostgreSQL assertions have not run locally. First remote CI run and
independent security review remain required. Further explicit policy-revision,
expired-enrollment, retarget downstream-state and installer rollback assertions
should be added before production installation.

## Still missing for activation

Reviewed installation/ACL baseline; genuine immutable owner policy enrollment;
current authenticated admin tied to exact approved manifest and candidates;
complete independent fixture results; internal cron handler/flag and deployment
review. No enrollment or candidate is fabricated here. Generation, QA, watermark
checks and social delivery remain separate capabilities, not activated by planning.
