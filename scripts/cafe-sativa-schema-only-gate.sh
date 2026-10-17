#!/usr/bin/env bash
# Explicit, reviewed schema-only staging replay. Never copies rows or credentials.
set -euo pipefail
: "${CS_SOURCE_DATABASE_URL:?Set a read-only source Postgres URL}"
: "${CS_NEON_STAGING_DATABASE_URL:?Set isolated Neon direct connection URL}"
: "${CS_EXPECTED_STAGING_DB:=cafe_sativa_stage}"
command -v pg_dump >/dev/null
command -v psql >/dev/null
source_db="$(psql "$CS_SOURCE_DATABASE_URL" -XAtqc "select current_database()")"
target_db="$(psql "$CS_NEON_STAGING_DATABASE_URL" -XAtqc "select current_database()")"
[[ "$target_db" == "$CS_EXPECTED_STAGING_DB" ]] || { echo "Wrong staging destination: $target_db" >&2; exit 2; }
[[ "$CS_SOURCE_DATABASE_URL" != "$CS_NEON_STAGING_DATABASE_URL" ]] || { echo "Source equals destination" >&2; exit 2; }
[[ "${CS_AUTHORIZE_EMPTY_SCHEMA_REPLAY:-}" == "YES" ]] || { echo "Set CS_AUTHORIZE_EMPTY_SCHEMA_REPLAY=YES after reviewing scope." >&2; exit 2; }
existing="$(psql "$CS_NEON_STAGING_DATABASE_URL" -XAtqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")"
[[ "$existing" == 0 ]] || { echo "Target not empty. Create a fresh isolated Neon branch." >&2; exit 2; }
echo "Source database: $source_db; target: $target_db; copying SCHEMA ONLY." >&2
# Do not migrate Supabase-managed auth/storage objects or include data.
# REVIEW the resulting schema for Supabase extensions, grants, Auth FKs and side-effect triggers.
umask 077
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pg_dump "$CS_SOURCE_DATABASE_URL" --schema-only --schema=public --no-owner --no-privileges --file="$tmp/public.sql"
echo "Schema DDL captured in a temporary private directory. Review dependencies before applying." >&2
if [[ "${CS_APPLY_REVIEWED_SCHEMA:-}" != "YES" ]]; then
 echo "Dry-run complete. No SQL applied. Full schema application requires independently reviewed DDL plus safe Auth/Storage compatibility plan." >&2
 exit 0
fi
echo "Refusing to apply raw Supabase DDL: use the separately reviewed, versioned Neon migration, not a blind pg_dump." >&2
exit 3
