#!/usr/bin/env bash
# Hosted isolated CI only. NOT EXECUTED locally; no socket/network workaround.
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || { echo 'Requires isolated localhost CI PostgreSQL'; exit 1; }
cd "$(dirname "$0")/../.."
export PGDATABASE="persona_qa_fixture_${RANDOM}_$$"
createdb "$PGDATABASE"
trap 'dropdb "$PGDATABASE"' EXIT
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-fixture.sql
for file in supabase/migrations/20261020154000_character_canon_spoken_promos.sql supabase/migrations/20261020173000_character_promo_qa_checks.sql supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql docs/proposals/persona-delivery-ledger.sql tests/sql/persona-gates-seed.sql docs/proposals/persona-approval-gates.sql docs/proposals/persona-owner-revocation.sql docs/proposals/persona-qa-observation.sql tests/sql/persona-qa-observation-tests.sql; do
 psql -X -v ON_ERROR_STOP=1 -f "$file"
done
psql -X -v ON_ERROR_STOP=1 <<'SQL'
create table qa_race_saved as select d.updated_at revision,to_jsonb(q) observation from public.cs_character_promo_drafts d join public.cs_character_promo_qa_checks q on q.promo_id=d.id where q.check_name='lip_sync';
create function qa_race_save() returns jsonb language sql as $$ select public.cs_record_character_promo_qa_observation('00000000-0000-0000-0000-000000000010',repeat('a',64),revision,'lip_sync','needs_review','Synthetic race assertion only',observation,'00000000-0000-0000-0000-000000000001') from qa_race_saved $$;
SQL
barrier() {
 for _ in $(seq 1 150); do
  [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='persona_qa_racer' and wait_event='PgSleep'")" == 1 ]] && return 0
  sleep 0.02
 done
 echo 'Race barrier not reached'; exit 1
}
# Concurrent same observation contenders: second waits on parent, then stale CAS fails.
PGAPPNAME=persona_qa_racer psql -X -v ON_ERROR_STOP=1 <<'SQL' &
begin;
select assert_ok(qa_race_save() is not null,'first observer wins');
select pg_sleep(4);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 -c "select assert_ok(qa_race_save() is null,'second observer loses after parent wait')"
wait "$pid"
psql -X -v ON_ERROR_STOP=1 -c "update qa_race_saved set observation=(select to_jsonb(q) from public.cs_character_promo_qa_checks q where check_name='lip_sync')"
# Media replacement holds parent lock; old explicitly viewed bytes never get new QA.
PGAPPNAME=persona_qa_racer psql -X -v ON_ERROR_STOP=1 <<'SQL' &
begin;
update public.cs_character_promo_drafts set video_asset_path=replace(video_asset_path,repeat('a',64),repeat('b',64));
select pg_sleep(4);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 -c "select assert_ok(qa_race_save() is null,'old media denied after parent wait')"
wait "$pid"
psql -X -v ON_ERROR_STOP=1 -c "update public.cs_character_promo_drafts set video_asset_path=replace(video_asset_path,repeat('b',64),repeat('a',64)); update qa_race_saved set revision=(select updated_at from public.cs_character_promo_drafts)"
# Admin revocation while parent held: second auth read sees committed revocation.
PGAPPNAME=persona_qa_racer psql -X -v ON_ERROR_STOP=1 <<'SQL' &
begin;
select id from public.cs_character_promo_drafts for update;
update auth.users set raw_app_meta_data='{}';
select pg_sleep(4);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin begin perform qa_race_save(); raise exception 'unexpected authority'; exception when others then if sqlerrm<>'Verified content admin required' then raise; end if; end; end $$;
SQL
wait "$pid"
echo 'PASS: hosted isolated observation CAS, media replacement and auth-revocation races'
