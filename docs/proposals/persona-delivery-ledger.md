# Dormant persona delivery ledger proposal

This is an offline proposal, not an executable migration in `supabase/migrations`. No live data has been read or changed. No provider submission, publication, automation, or route is activated.

## Contract and trust boundary

- `cs_approve_character_promo(plan UUID, digest TEXT, snapshot JSONB, approved_at TIMESTAMPTZ, actor UUID)` returns boolean. Approval is a distinct explicit owner action. The trusted backend must fetch the user afresh using `auth.getUser()`, require `app_metadata.cafe_sativa_admin === true`, bind the actor to that verified user, verify same-origin/CSRF at any eventual route, and display/confirm the exact snapshot. Browser actor fields are forbidden. SQL checks current `auth.users.raw_app_meta_data` and an explicit private owner allowlist, initially empty.
- `cs_claim_character_promo(plan UUID, digest TEXT, snapshot JSONB)` returns a unique token or NULL. SQL derives current source rows under a parent-draft lock and checks immutable approval equality plus current admin/owner membership. Any RPC error/timeout/unknown result must prevent a provider call, even if the database may have committed a claim.
- `cs_finish_character_promo(plan UUID, token UUID, state TEXT, receipt JSONB)` returns boolean using compare-and-set from `submitting`. Only an exact verified scheduling receipt permits `scheduled`. Neither state means `published`. An ambiguous result becomes `submission_unknown`, permanently non-retryable. A lost claim response leaves `submitting`, also permanently non-retryable.

The snapshot additionally pins canon.revisionSha256, an authoritative full canonical context/persona rules and rights/identity evidence fingerprint. Its trusted derivation is an activation-blocking source-reader requirement, not an invented timestamp or media-only hash.

The digest is an opaque identifier computed by the trusted TypeScript canonical serializer. PostgreSQL does NOT hash `jsonb::text` or pretend it produces the same digest. It compares the entire approved JSONB snapshot exactly and the digest exactly. Approval source evidence includes complete SQL draft/plan/QA rows. Explicit approval time is supplied by the owner action; no approval timestamps are inferred from nullable content fields. Database claim time is operational bookkeeping only.

SQL cannot read video bytes, query live canonical assets/rights, or independently verify provider connections. The dormant engine recomputes the file SHA-256 and requires fresh trusted canonical/connection reads. A real trusted read/upload/provider adapter has not been activated. Frozen database rows cannot freeze third-party rights or account status. Those adapters and external revalidation immediately before a provider call remain deployment requirements.

`cs_read_character_promo_approval(plan UUID)` is a service-only reader returning null for missing/invalidated/non-owner/non-admin approval. It exposes no private table privileges. Its result is only preliminary: claim revalidates the source and permanent attempt gate atomically.

## Schema and privileges

Adds nullable `caption` to delivery plans with no fabricated content; a new private schema contains an empty owner allowlist with an enabled flag, immutable one-per-plan approval, and one-per-plan permanent attempt. There is no automatic reapproval, claim expiry, deletion, retry, publication inference, or attempt reset. If an approval goes stale, the plan needs a separately reviewed replacement workflow; this proposal deliberately provides none.

Approval, claim, and source writes require READ COMMITTED isolation; other isolation levels fail closed to avoid stale MVCC snapshots after a waited lock. All source writes lock the parent draft. Preclaim edits invalidate approval even if reverted. After any attempt exists, draft, plan, and QA mutations are blocked permanently, including QA inserts. A single claimed draft freezes its other delivery plans as a conservative safety measure. Source tables' existing access policies remain unchanged.

All definer functions use `search_path=pg_catalog` and schema-qualified objects. Public/anon/authenticated have no RPC execution, and service_role has only the four RPCs, not private schema/table access. Helpers have no public execute. A separately reviewed migration-owner role must own the schema/tables/functions; service_role must not own them or inherit owner privileges. Tests check the ordinary role/ownership assumptions, not privilege attacks.

## Required deployment gates

1. Independent review and real multi-session PostgreSQL CI must pass on the exact final candidate. No such CI execution has occurred yet.
2. Obtain action-time approval for the precise schema, function, trigger, grant, and source-freeze changes before applying any production SQL. This proposal is intentionally outside auto migrations.
3. Explicitly approve which existing verified `auth.users.id` is the persona delivery owner, then separately authorize inserting only that UUID into `cs_promo_private.owners`. Do not bootstrap it from an admin browser request. Confirm current admin metadata and migration-object ownership/ACLs. To revoke only persona approval authority later, separately authorize the migration owner to set that owner row enabled=false; never delete approval evidence. Approval/read/claim all enforce this flag. No browser/service-role direct owner mutation is granted. Revocation after a claim cannot cancel an in-flight provider call or erase an existing schedule; it blocks subsequent approval/read/claim, and any outstanding claim requires manual reconciliation.
4. Integrate and review a real owner-confirmation UI and trusted identity adapter, immutable canonical/rights evidence, actual storage-byte verification, fresh provider destination verification, and exact provider readback. No live adapters/routes/cron are present in this change.
5. Existing drafts remain unapproved. Obtain a new explicit final owner approval of the actual file hash, exact spoken words/caption/time, canonical identity and rights, all eight QA rows, and the exact destination. No ledger backfill or autoapproval is permitted.
6. Provider calls remain disabled until separately approved activation. Paid generation, publication, scheduled job enablement, and production schema work are separate decisions.

## Verification

The existing extracted official Debian PostgreSQL 17.11 executable was used in a newly initialized candidate-local data directory. Sequential SQL ran in PostgreSQL single-user mode, not a JavaScript fake store. A normal server startup failed because creation of its Unix socket returned `Operation not permitted`; no alternate socket/TCP path or sandbox changes were attempted.

Local sequential coverage includes no implicit approval, immutable approval, digest conflicts, exact destination binding, stale/reverted edits, QA mutation, current owner-admin membership, denied browser execute/private-table writes, fixed search paths and ownership assumptions, permanent claims, source mutation freeze, unknown terminal outcomes, exact receipt binding and scheduled versus published semantics.

`tests/sql/run-persona-ledger-ci.sh` and `.github/workflows/persona-ledger-proposal.yml` prepare genuine PostgreSQL 17 multi-session same-plan and concurrent-QA-edit races using separate sessions and a lock-hold barrier. They use only an isolated localhost disposable CI database and no application credentials. They have NOT been executed or pushed. Local `.local-pg-persona/` is disposable test runtime/evidence, not source or a release artifact; exclude it from patches and archives.
