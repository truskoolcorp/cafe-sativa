#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || { echo 'Requires isolated localhost CI PostgreSQL'; exit 1; }
cd "$(dirname "$0")/../.."
mkdir -p .persona-gates-ci
first_setup=true
setup() {
 export PGDATABASE="persona_gates_fixture_$1"
 createdb "$PGDATABASE"
 if $first_setup; then
  psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-fixture.sql
  first_setup=false
 else
  sed '/^create role /d' tests/sql/persona-ledger-fixture.sql | psql -X -v ON_ERROR_STOP=1
 fi
 for file in supabase/migrations/20261020154000_character_canon_spoken_promos.sql supabase/migrations/20261020173000_character_promo_qa_checks.sql supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql docs/proposals/persona-delivery-ledger.sql tests/sql/persona-gates-seed.sql docs/proposals/persona-approval-gates.sql docs/proposals/persona-owner-revocation.sql; do
  psql -X -v ON_ERROR_STOP=1 -f "$file"
 done
}
for scenario in tests two-plan revocation; do
 setup "${scenario//-/_}"
 psql -X -v ON_ERROR_STOP=1 -f "tests/sql/persona-gates-$scenario.sql"
done
setup races
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-gates-race-seed.sql
barrier() {
 for _ in $(seq 1 100); do
  [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='persona_gate_racer' and wait_event='PgSleep'")" == 1 ]] && return 0
  sleep 0.02
 done
 echo 'Race barrier not reached'; exit 1
}
PGAPPNAME=persona_gate_racer psql -X -v ON_ERROR_STOP=1 > .persona-gates-ci/first-gate.log <<'SQL' &
begin;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001') is not null,'first gate wins') from gate_content;
select pg_sleep(3);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001') is null,'concurrent gate cannot overwrite') from gate_content;
SQL
wait "$pid"
psql -X -v ON_ERROR_STOP=1 -c 'update saved_state set expected=public.gate_expected();'
PGAPPNAME=persona_gate_racer psql -X -v ON_ERROR_STOP=1 > .persona-gates-ci/first-replacement.log <<'SQL' &
begin;
select public.assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),expected,'00000000-0000-0000-0000-000000000001') is not null,'first explicit replacement wins') from gate_content cross join saved_state;
select pg_sleep(3);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),expected,'00000000-0000-0000-0000-000000000001') is null,'old generation replacement replay rejected') from gate_content cross join saved_state;
SQL
wait "$pid"
PGAPPNAME=persona_gate_racer psql -X -v ON_ERROR_STOP=1 > .persona-gates-ci/revocation.log <<'SQL' &
begin;
update cs_promo_private.owners set enabled=false;
select pg_sleep(3);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin begin perform public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'00000000-0000-0000-0000-000000000001') from gate_content; raise exception 'Revoked actor incorrectly accepted after waited lock'; exception when others then if sqlerrm <> 'Verified owner required' then raise; end if; end; end $$;
SQL
wait "$pid"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
update cs_promo_private.owners set enabled=true;
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'concurrent revoke restore does not revive');
select public.assert_ok((select count(*)=2 from cs_promo_private.review_versions),'no generation created by revoked actor');
SQL
echo 'Real PostgreSQL gate, replacement, and revocation races passed.'

# First-ever authority race: no review/gate/approval evidence exists when revocation
# scans. The later contribution must bind the OLD captured epoch and stay invalid.
setup first_authority
sed '/^select public.cs_begin_character_promo_review/d' tests/sql/persona-gates-race-seed.sql | psql -X -v ON_ERROR_STOP=1
PGAPPNAME=persona_gate_racer psql -X -v ON_ERROR_STOP=1 > .persona-gates-ci/first-authority-revoke.log <<'SQL' &
begin;
update cs_promo_private.owners set enabled=false;
select pg_sleep(3);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'00000000-0000-0000-0000-000000000001') from gate_content;
SQL
wait "$pid"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
update cs_promo_private.owners set enabled=true;
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'first-ever concurrent authority stays revoked after restore');
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001') is null,'stale first contribution cannot confirm') from gate_content;
SQL
echo 'First-ever authority epoch race passed.'
