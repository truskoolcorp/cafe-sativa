#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$GITHUB_ACTIONS" = true
test "$GITHUB_EVENT_NAME" = pull_request
test "$GITHUB_REPOSITORY" = truskoolcorp/cafe-sativa
test "$GITHUB_HEAD_REF" = qa/zaria-text-local-backend-20261124
test "$GITHUB_RUN_ATTEMPT" = 1
test "$(git rev-parse HEAD)" = "$ZARIA_QA_EXACT_HEAD"
for f in .env .env.local .env.development .env.development.local; do test ! -e "$f"; done
tmp="$(mktemp -d "$RUNNER_TEMP/zaria-local.XXXXXXXX")"
cli="$tmp/bin/supabase"
stage='local prerequisites'
mkdir -p "$tmp/bin" "$tmp/stack" "$tmp/cli-home"
local_cli() { env -i PATH="$PATH" HOME="$tmp/cli-home" DO_NOT_TRACK=1 "$cli" "$@" --workdir "$tmp/stack"; }
cleanup() {
 local status=$?
 if test "$status" != 0; then printf 'Local-only Zaria QA stopped at: %s. Raw environment diagnostics suppressed.\n' "$stage" >&2; fi
 if test -x "$cli"; then local_cli stop --no-backup >/dev/null 2>&1 || true; fi
 rm -rf -- "$tmp"
}
trap cleanup EXIT
docker info >/dev/null 2>&1
pgbindir="$(pg_config --bindir)"
test -x "$pgbindir/psql"
stage='verify pinned Supabase CLI bytes'
archive="$tmp/supabase.tar.gz"
curl --disable --silent --show-error --fail --location --proto '=https' --proto-redir '=https' \
 'https://github.com/supabase/cli/releases/download/v3.3.0/supabase_3.3.0_linux_amd64.tar.gz' -o "$archive"
printf '%s  %s\n' 8d12731ae522a8f263170ca719b33f163dd05f4365ae6c22b31714dfa1e92b9b "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$tmp/bin" --no-same-owner supabase
stage='local Supabase startup'
local_cli init >"$tmp/cli-init" 2>&1
local_cli start >"$tmp/cli-start" 2>&1
local_cli status -o json >"$tmp/status.json" 2>"$tmp/cli-error"
stage='Next, PostgREST and synthetic inference runtime'
env -i PATH="$PATH" HOME="$tmp/cli-home" ZARIA_LOCAL_PSQL="$pgbindir/psql" node tests/zaria-local-backend.cjs "$tmp/status.json"
