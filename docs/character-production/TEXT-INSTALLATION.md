# Exact text-store installation checklist (not activation)

`prepare-character-text-install.py` derives a rollback-only rehearsal from the
reviewed text SQL plus SHA256-pinned private before/after catalog manifests. It
never connects to a database and has no commit/grant/lease option. Do not upload
private catalog manifests to a repository. Existing catalog query/helper are
reused unchanged.

## Verified live prerequisites (read-only November 16 audit)

- Restricted owner `character_production_owner` is NOLOGIN, NOINHERIT, not
  superuser and no RLS bypass. Owns existing `character_production` schema.
- Its only membership is postgres, grantor supabase_admin, ADMIN true,
  INHERIT false, SET false. Thus naive `SET ROLE` cannot install.
- Owner has public schema USAGE, not CREATE. Its global function default ACL
  is owner-only. Three text RPCs are not installed.

## Source-only rehearsal and promotion

1. Refresh private full catalog with existing `scripts/cafe-standing-catalog.sql`
   under `search_path=pg_catalog` for BOTH manifests, matching installer guards.
   Regprocedure/regclass identities otherwise differ by qualification.
   Derive expected after catalog from an isolated PG17 matching fixture; manually
   review exact two table/four index/three function additions and their complete
   columns/constraints/defaults/ACLs. Preserve every existing catalog row.
2. Generate rehearsal using `--before`, `--after`, and both `--*-sha256` values.
   Source pin must match reviewed SQL. Run actual PG17 tests plus rollback
   rehearsal against the approved exact catalog. Python tests are only generator
   tests, not proof of successful PostgreSQL execution.
3. Temporary capability INSIDE one transaction: postgres self-grants membership
   in restricted owner WITH ADMIN FALSE, INHERIT FALSE, SET TRUE, GRANTED BY
   postgres; grants owner CREATE on public; SET LOCAL ROLE owner.
4. Create reviewed objects as owner. No budget/attempt rows; RPCs owner-only;
   no credential, role definition, default ACL, runtime grant or activation.
5. RESET ROLE; revoke public CREATE; revoke ONLY postgres-granted owner
   membership. Original supabase_admin-granted membership is preserved. Exact
   after-manifest comparison verifies full lifecycle/ACL restoration.
6. Artifact ends ROLLBACK. A production COMMIT promotion requires separate exact
   source/catalog review and approval of these temporary installer capabilities.
   Failure must roll back all changes, not resume from half-installed objects.

## Separate runtime access proposal (not included/executed)

Only after install verification and explicit applicable approval, grant EXECUTE
on these exact signatures to existing `service_role`:

- `public.character_production_text_claim(text,text,jsonb,uuid,text,integer,integer,text,bigint,integer,integer)`
- `public.character_production_text_authorized(text,uuid,text,uuid,bigint,integer,integer,integer,integer,text)`
- `public.character_production_text_save(text,uuid,text,jsonb,text,integer,integer)`

No table/schema CREATE access, owner membership, PUBLIC/anon/authenticated grant,
or direct text-table access is proposed. Existing server credential is used in
place, not copied or replaced. This is a material capability expansion:
Storage admin can SET authenticator, which can SET service_role; it therefore
also obtains the new RPC capability indirectly. Postgres inherits service_role.
An application three-name allowlist does NOT remove that database-level access.

## Still separate from access

Explicit disabled-by-default numeric Anthropic lease, verified token rates,
per-attempt reservation, Dallas-month cap, finite expiry, persona/room canon
scope and derived daily persona cadence are required. HeyGen's $20 allowance
is not text spending approval. No automatic lease renewal/top-up. No public
posting from text creation: result is awaiting_audio_binding_and_qa. The new
operation has no route/cron. Fresh speech, audio binding, new draft/enrollment,
video, QA and standing publication linkage remain distinct verified steps.
