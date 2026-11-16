#!/usr/bin/env bash
# Hosted disposable PostgreSQL only. Never run locally to bypass socket restrictions.
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || { echo 'Requires isolated localhost CI PostgreSQL'; exit 1; }
cd "$(dirname "$0")/../.."
first=true
suffix="${RANDOM}_$$"
export PGDATABASE=""
trap 'if [[ -n "$PGDATABASE" ]]; then dropdb --if-exists "$PGDATABASE"; fi' EXIT
setup() {
 if [[ -n "$PGDATABASE" ]]; then dropdb "$PGDATABASE"; fi
 export PGDATABASE="persona_authoring_${1}_${suffix}"
 createdb "$PGDATABASE"
 if $first; then psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-fixture.sql; first=false
 else sed '/^create role /d' tests/sql/persona-ledger-fixture.sql | psql -X -v ON_ERROR_STOP=1; fi
 for file in supabase/migrations/20261020154000_character_canon_spoken_promos.sql supabase/migrations/20261020173000_character_promo_qa_checks.sql supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql docs/proposals/persona-delivery-ledger.sql tests/sql/persona-gates-seed.sql docs/proposals/persona-approval-gates.sql docs/proposals/persona-owner-revocation.sql docs/proposals/persona-plan-authoring.sql; do psql -X -v ON_ERROR_STOP=1 -f "$file"; done
}
prepare_review() {
 psql -X -v ON_ERROR_STOP=1 <<'SQL'
create table public.authoring_race_reviews as select public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','Explicitly reviewed caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001') r;
select assert_ok(r is not null,'race review created') from authoring_race_reviews;
create function public.authoring_save() returns jsonb language sql as $$ select public.cs_save_character_promo_plan_edit(r->'snapshot',r->>'digest','00000000-0000-0000-0000-000000000001') from authoring_race_reviews $$;
SQL
}
barrier() {
 local app="$1" predicate="$2"
 for _ in $(seq 1 200); do
  [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where datname=current_database() and application_name='$app' and $predicate")" == 1 ]] && return 0
  sleep 0.02
 done
 echo "Race barrier not reached: $app $predicate"; exit 1
}
# Verify actual overlapping parent-lock contention rather than merely sequential calls.
race() {
 local first_sql="$1" second_sql="$2"
 PGAPPNAME=persona_authoring_first psql -X -v ON_ERROR_STOP=1 -c "begin; $first_sql; select pg_sleep(10); commit;" &
 local first_pid=$!
 barrier persona_authoring_first "wait_event='PgSleep'"
 PGAPPNAME=persona_authoring_second psql -X -v ON_ERROR_STOP=1 -c "$second_sql" &
 local second_pid=$!
 barrier persona_authoring_second "wait_event_type='Lock'"
 wait "$first_pid"
 wait "$second_pid"
}
setup assertions
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-plan-authoring-tests.sql
setup save_save
prepare_review
race "select assert_ok(authoring_save() is not null,'first save wins')" "select assert_ok(authoring_save() is null,'waiting save cannot replay')"
psql -X -v ON_ERROR_STOP=1 -c "select assert_ok((select count(*)=1 from cs_promo_private.plan_edit_reviews where saved_at is not null),'one saved review')"
setup claim_save
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-authoring-claim-seed.sql
prepare_review
race "select assert_ok(authoring_claim() is not null,'real claim wins')" "select assert_ok(authoring_save() is null,'waiting save sees durable claim')"
psql -X -v ON_ERROR_STOP=1 -c "select assert_ok((select count(*)=1 from cs_promo_private.attempts),'claim retained'); select assert_ok((select caption='Exact caption' from public.cs_character_promo_delivery_plans),'claimed caption unchanged')"
setup save_claim
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-authoring-claim-seed.sql
prepare_review
race "select assert_ok(authoring_save() is not null,'save wins')" "select assert_ok(authoring_claim() is null,'waiting real claim sees invalidated consent')"
psql -X -v ON_ERROR_STOP=1 -c "select assert_ok((select count(*)=0 from cs_promo_private.attempts),'no claim after edit')"
setup revoked_save
prepare_review
# No generation/gate/approval evidence: explicitly hold parent while epoch changes.
race "select id from public.cs_character_promo_drafts for update; update cs_promo_private.owners set enabled=false" 'do $$ begin begin perform authoring_save(); raise exception '\''Revoked owner accepted'\''; exception when others then if sqlerrm<>'\''Verified owner required'\'' then raise; end if; end; end $$'
psql -X -v ON_ERROR_STOP=1 -c "update cs_promo_private.owners set enabled=true; select assert_ok(authoring_save() is null,'restored owner cannot replay old epoch'); select assert_ok((select count(*)=0 from cs_promo_private.plan_edit_reviews where saved_at is not null),'revocation race saved nothing')"
setup stale_draft
prepare_review
race "update public.cs_character_promo_drafts set title='Concurrent source edit'" "select assert_ok(authoring_save() is null,'waiting save sees exact changed draft')"
echo 'PASS: hosted PG17 authoring assertions and observed lock races for save/save, claim/save, save/claim, first-evidence revocation/save, and stale-draft/save'
