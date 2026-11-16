#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || { echo 'Requires isolated localhost CI PostgreSQL'; exit 1; }
cd "$(dirname "$0")/../.."
mkdir -p .persona-controls-ci
first_setup=true
setup() {
 export PGDATABASE="persona_controls_fixture_$1"
 createdb "$PGDATABASE"
 if $first_setup; then psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-fixture.sql; first_setup=false
 else sed '/^create role /d' tests/sql/persona-ledger-fixture.sql | psql -X -v ON_ERROR_STOP=1; fi
 for file in supabase/migrations/20261020154000_character_canon_spoken_promos.sql supabase/migrations/20261020173000_character_promo_qa_checks.sql supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql docs/proposals/persona-delivery-ledger.sql tests/sql/persona-gates-seed.sql docs/proposals/persona-approval-gates.sql docs/proposals/persona-owner-revocation.sql docs/proposals/persona-plan-authoring.sql docs/proposals/persona-plan-withdrawal.sql; do
  psql -X -v ON_ERROR_STOP=1 -f "$file"
 done
}
setup controls
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-plan-withdrawal-tests.sql
for scenario in after-claim restore; do
 setup "${scenario//-/_}"
 psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-plan-controls-ready-seed.sql
 psql -X -v ON_ERROR_STOP=1 -f "tests/sql/persona-plan-withdrawal-$scenario.sql"
done
setup partial
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-plan-controls-partial-seed.sql
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-plan-withdrawal-partial.sql
barrier() {
 for _ in $(seq 1 100); do
  [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='persona_control_racer' and wait_event='PgSleep'")" == 1 ]] && return 0
  sleep 0.02
 done
 echo 'Race barrier not reached'; exit 1
}
for scenario in withdrawal_first target_claim_first sibling_claim_first; do
 setup "$scenario"
 psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-plan-controls-ready-seed.sql
 psql -X -v ON_ERROR_STOP=1 <<'SQL'
create table public.race_ticket as select public.cs_review_character_promo_plan_control('00000000-0000-0000-0000-000000000021','withdraw','00000000-0000-0000-0000-000000000001') ticket;
SQL
 if [[ "$scenario" == withdrawal_first ]]; then
  PGAPPNAME=persona_control_racer psql -X -v ON_ERROR_STOP=1 > .persona-controls-ci/withdrawal-first.log <<'SQL' &
begin;
select public.assert_ok((public.cs_save_character_promo_plan_control(ticket->'snapshot',ticket->>'digest','00000000-0000-0000-0000-000000000001')->>'withdrawn')::boolean,'withdraw wins parent lock') from race_ticket;
select pg_sleep(3);
commit;
SQL
  pid=$!; barrier
  psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000021',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000021')) is null,'losing claim must not submit');
SQL
 elif [[ "$scenario" == target_claim_first ]]; then
  PGAPPNAME=persona_control_racer psql -X -v ON_ERROR_STOP=1 > .persona-controls-ci/target-claim-first.log <<'SQL' &
begin;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000021',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000021')) is not null,'target claim wins parent lock');
select pg_sleep(3);
commit;
SQL
  pid=$!; barrier
  psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_save_character_promo_plan_control(ticket->'snapshot',ticket->>'digest','00000000-0000-0000-0000-000000000001')->>'status'='reconciliation_required','losing withdrawal cannot claim cancellation') from race_ticket;
SQL
 else
  PGAPPNAME=persona_control_racer psql -X -v ON_ERROR_STOP=1 > .persona-controls-ci/sibling-claim-first.log <<'SQL' &
begin;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is not null,'sibling claim starts first');
select pg_sleep(3);
commit;
SQL
  pid=$!; barrier
  psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok((public.cs_save_character_promo_plan_control(ticket->'snapshot',ticket->>'digest','00000000-0000-0000-0000-000000000001')->>'withdrawn')::boolean,'unattempted target can stop after waited sibling activity') from race_ticket;
SQL
 fi
 wait "$pid"
done
echo 'Actual PostgreSQL withdrawal/claim and sibling-progress races passed.'

setup restore_claim_first
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-plan-controls-ready-seed.sql
psql -X -v ON_ERROR_STOP=1 <<'SQL'
create table public.stop_ticket as select public.cs_review_character_promo_plan_control('00000000-0000-0000-0000-000000000021','withdraw','00000000-0000-0000-0000-000000000001') ticket;
select public.cs_save_character_promo_plan_control(ticket->'snapshot',ticket->>'digest','00000000-0000-0000-0000-000000000001') from stop_ticket;
create table public.restore_ticket as select public.cs_review_character_promo_plan_control('00000000-0000-0000-0000-000000000021','restore','00000000-0000-0000-0000-000000000001') ticket;
SQL
PGAPPNAME=persona_control_racer psql -X -v ON_ERROR_STOP=1 > .persona-controls-ci/restore-claim-first.log <<'SQL' &
begin;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is not null,'first shared claim wins before restore');
select pg_sleep(3);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_save_character_promo_plan_control(ticket->'snapshot',ticket->>'digest','00000000-0000-0000-0000-000000000001')->>'status'='shared_dispatch_started','old restore cannot expand cohort after waited claim') from restore_ticket;
SQL
wait "$pid"
echo 'Actual PostgreSQL restore-vs-first-claim race passed.'
