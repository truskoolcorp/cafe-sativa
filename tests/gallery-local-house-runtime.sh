#!/usr/bin/env bash
# Credential-free synthetic run; no Stripe CLI command or provider payment operation.
set -euo pipefail
umask 077
test "$GITHUB_ACTIONS" = true
test "$GITHUB_EVENT_NAME" = pull_request
test "$GITHUB_REPOSITORY" = truskoolcorp/cafe-sativa
test "$GITHUB_HEAD_REF" = qa/gallery-house-local-runtime-20261124
test "$GITHUB_RUN_ATTEMPT" = 1
test "$(git rev-parse HEAD)" = "$GALLERY_QA_EXACT_HEAD"
for f in .env .env.local .env.development .env.development.local; do test ! -e "$f"; done
tmp="$(mktemp -d "$RUNNER_TEMP/gallery-local-test.XXXXXXXX")"
stage='runner prerequisite check'
cli="$tmp/bin/supabase"
mkdir -p "$tmp/bin" "$tmp/stack" "$tmp/cli-home"
cleanup() {
 local status=$?
 if test "$status" != 0; then printf 'Isolated test stopped at: %s. Raw diagnostics suppressed.\n' "$stage" >&2; fi
 if test -x "$cli"; then env -i PATH="$PATH" HOME="$tmp/cli-home" DO_NOT_TRACK=1 "$cli" stop --workdir "$tmp/stack" --no-backup > /dev/null 2>&1 || true; fi
 if test -f "$tmp/qa-route-created"; then rm -f -- app/api/gallery/synthetic-mode-check/route.ts; rmdir -- app/api/gallery/synthetic-mode-check 2>/dev/null || true; fi
 rm -rf -- "$tmp"
}
trap cleanup EXIT
docker info >/dev/null 2>&1
pgbindir="$(pg_config --bindir)"
test -x "$pgbindir/psql"
stage='Supabase CLI Linux checksum verification'
archive="$tmp/supabase.tar.gz"
curl --disable --silent --show-error --fail --location --proto '=https' --proto-redir '=https' \
 'https://github.com/supabase/cli/releases/download/v3.3.0/supabase_3.3.0_linux_amd64.tar.gz' -o "$archive" 2>"$tmp/download-error"
printf '%s  %s\n' 8d12731ae522a8f263170ca719b33f163dd05f4365ae6c22b31714dfa1e92b9b "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$tmp/bin" --no-same-owner supabase
test -x "$cli"
printf 'PASS: verified pinned Supabase CLI bytes.\n'
stage='fresh Supabase Docker stack'
local_cli() { env -i PATH="$PATH" HOME="$tmp/cli-home" DO_NOT_TRACK=1 "$cli" "$@" --workdir "$tmp/stack"; }
local_cli init >"$tmp/cli-init" 2>&1
local_cli start >"$tmp/cli-start" 2>&1
local_cli status -o json >"$tmp/local-status.json" 2>"$tmp/cli-status-error"
stage='strict local database endpoint and migrations'
# No strings from the local CLI are evaluated as shell code or emitted to console.
# Parse status and run psql with its login data restricted to process environment.
if ! GALLERY_PSQL="$pgbindir/psql" node --input-type=module - "$tmp/local-status.json" >"$tmp/sql-output" 2>"$tmp/sql-error" <<'NODE'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {parseLocalSupabaseStatus} from './tests/gallery-house-sandbox-prep.mjs'
const c=parseLocalSupabaseStatus(readFileSync(process.argv[2],'utf8'))
const db=new URL(c.db)
const run=(args)=> {
 const r=spawnSync(process.env.GALLERY_PSQL,['-X','-v','ON_ERROR_STOP=1',...args],{stdio:'ignore',timeout:15000,
  env:{PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:'54322',PGDATABASE:'postgres',
   PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGCONNECT_TIMEOUT:'5'}})
 if(r.status!==0)throw Error('local PostgreSQL fixture failed')
}
run(['-c',"set gallery.local_sandbox='on'",'-f','tests/fixtures/gallery-local-house-base.sql'])
for(const n of ['proposed-private-delivery-migration','proposed-approved-artwork-assets','proposed-fulfillment-authorization',
 'proposed-delivery-outbox','proposed-inventory-reservations','proposed-inventory-consumption','proposed-refund-ledger',
 'proposed-settlement-observations','proposed-house-checkout']) run(['-f','docs/gallery/'+n+'.sql'])
NODE
then exit 1; fi
printf 'PASS: isolated local Supabase Auth, Storage and Gallery schema startup.\n'
# Generated only on this isolated runner; it is not checked in and never deployed.
test ! -e app/api/gallery/synthetic-mode-check
mkdir -p app/api/gallery/synthetic-mode-check
touch "$tmp/qa-route-created"
cat > app/api/gallery/synthetic-mode-check/route.ts <<'QA_DIAGNOSTIC'
import {galleryEnvironment} from '@/lib/gallery/environment'
export const dynamic='force-dynamic'
export function GET(req:Request) {
 const e=process.env
 if(e.GALLERY_QA_MODE_CHECK!=='true'||req.headers.get('host')!=='127.0.0.1:4116')return new Response(null,{status:404})
 const url=new URL(req.url)
 return Response.json({
  originMatches:url.origin===e.NEXT_PUBLIC_SITE_URL,reqIsHttp:url.protocol==='http:',reqIsLiteralLoopback:url.hostname==='127.0.0.1',reqIsLocalhost:url.hostname==='localhost',
  expectedSite:e.NEXT_PUBLIC_SITE_URL==='http://127.0.0.1:4116',
  expectedDb:e.NEXT_PUBLIC_SUPABASE_URL==='http://127.0.0.1:54321',
  dbMatches:e.NEXT_PUBLIC_SUPABASE_URL===e.GALLERY_TEST_SUPABASE_URL,
  credentialShape:/^rkcs_test_[A-Za-z0-9_]+$/.test(e.STRIPE_SECRET_KEY??''),
  accountMatches:/^acct_[A-Za-z0-9]+$/.test(e.GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID??'')&&e.GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID===e.GALLERY_HOUSE_STRIPE_ACCOUNT_ID,
  noVercel:!e.VERCEL_ENV&&!e.VERCEL&&!e.VERCEL_URL&&!e.VERCEL_DEPLOYMENT_ID,
  localOn:e.GALLERY_LOCAL_STRIPE_CLI==='true'&&e.GALLERY_ISOLATED_TEST==='true',
  ordinaryFlags:e.GALLERY_DELIVERY_NOTICES!=='true'&&!!e.GALLERY_TEST_STRIPE_WEBHOOK_SECRET&&!!e.SUPABASE_SERVICE_ROLE_KEY&&!!e.NEXT_PUBLIC_SUPABASE_ANON_KEY&&e.GALLERY_INVENTORY_HOLDS==='true'&&e.GALLERY_PRIVATE_DOWNLOADS==='true',
  modeIsolated:galleryEnvironment(req.url)==='isolated-test',
 },{headers:{'Cache-Control':'no-store'}})
}
QA_DIAGNOSTIC
stage='synthetic test app HTTP and browser'
NEXT_TELEMETRY_DISABLED=1 node tests/gallery-local-house-runtime.mjs "$tmp/local-status.json"
