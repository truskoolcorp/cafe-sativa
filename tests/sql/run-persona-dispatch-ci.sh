#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || { echo 'Requires isolated localhost CI PostgreSQL'; exit 1; }
cd "$(dirname "$0")/../.."
mkdir -p .persona-dispatch-ci
first_setup=true
setup() {
 export PGDATABASE="persona_dispatch_fixture_$1"
 createdb "$PGDATABASE"
 if $first_setup; then psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-fixture.sql; first_setup=false
 else sed '/^create role /d' tests/sql/persona-ledger-fixture.sql | psql -X -v ON_ERROR_STOP=1; fi
 for file in supabase/migrations/20261020154000_character_canon_spoken_promos.sql supabase/migrations/20261020173000_character_promo_qa_checks.sql supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql docs/proposals/persona-delivery-ledger.sql tests/sql/persona-gates-seed.sql docs/proposals/persona-approval-gates.sql docs/proposals/persona-owner-revocation.sql docs/proposals/persona-plan-authoring.sql docs/proposals/persona-plan-withdrawal.sql docs/proposals/persona-dispatch-owner.sql; do
  psql -X -v ON_ERROR_STOP=1 -f "$file"
 done
}
setup null_schedule
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-production-schedule-overlay.sql
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-null-schedule-tests.sql
psql -X -At -v ON_ERROR_STOP=1 -c 'select jsonb_object_agg(key,value) from null_schedule_export' > .persona-dispatch-ci/null-schedule-boundary.json
node tests/sql/persona-null-schedule-reader.cjs .persona-dispatch-ci/null-schedule-boundary.json
setup owner
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-ready-seed.sql
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-owner-tests.sql
setup precision
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-precision-seed.sql
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-precision-tests.sql
setup cohort_time
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-cohort-time-seed.sql
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-cohort-time-tests.sql
for instant in first second nearby; do
 setup "fold_$instant"
 psql -X -v ON_ERROR_STOP=1 -f "tests/sql/persona-dispatch-fold-$instant-seed.sql"
 if [[ "$instant" == nearby ]]; then check=allow; else check=reject; fi
 psql -X -v ON_ERROR_STOP=1 -f "tests/sql/persona-dispatch-fold-$check.sql"
done
setup expiry
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-expiry-seed.sql
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-expiry-tests.sql
setup races
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-ready-seed.sql
psql -X -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users values('00000000-0000-0000-0000-000000000002','{"cafe_sativa_admin":true}');
insert into cs_promo_private.owners(actor) values('00000000-0000-0000-0000-000000000002');
begin read only;
select public.assert_ok(public.cs_authorize_character_promo_dispatch('00000000-0000-0000-0000-000000000002')->>'actorEpoch'='0','authorize works in read-only transaction');
select public.assert_ok(public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000002',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020'),null),'preflight works in read-only transaction');
commit;
begin isolation level repeatable read;
select public.assert_ok(public.cs_authorize_character_promo_dispatch('00000000-0000-0000-0000-000000000002') is null,'non-read-committed authorization denied');
select public.assert_ok(not public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000002',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020'),null),'non-read-committed preflight denied');
rollback;
SQL
barrier() {
 for _ in $(seq 1 100); do
  [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='persona_dispatch_racer' and wait_event='PgSleep'")" == 1 ]] && return 0
  sleep 0.02
 done
 echo 'Race barrier not reached'; exit 1
}
PGAPPNAME=persona_dispatch_racer psql -X -v ON_ERROR_STOP=1 > .persona-dispatch-ci/claim-first.log <<'SQL' &
begin;
select public.assert_ok(public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000002',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is not null,'first caller claims');
select pg_sleep(3);
commit;
SQL
pid=$!; barrier
psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is null,'other caller cannot obtain second claim');
SQL
wait "$pid"
psql -X -v ON_ERROR_STOP=1 -c "select public.assert_ok((select count(*)=1 and min(dispatch_actor::text)='00000000-0000-0000-0000-000000000002' from cs_promo_private.attempts),'one caller-bound durable attempt');"
# Fresh fixture: independent caller has no content/gate evidence, so its role loss
# can commit while the shared draft is held by another transaction.
setup waited_epoch
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-dispatch-ready-seed.sql
psql -X -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users values('00000000-0000-0000-0000-000000000002','{"cafe_sativa_admin":true}');
insert into cs_promo_private.owners(actor) values('00000000-0000-0000-0000-000000000002');
select public.assert_ok(public.cs_authorize_character_promo_dispatch('00000000-0000-0000-0000-000000000002')->>'actorEpoch'='0','request captures initial caller epoch');
SQL
PGAPPNAME=persona_dispatch_racer psql -X -v ON_ERROR_STOP=1 > .persona-dispatch-ci/parent-holder.log <<'SQL' &
begin;
select id from public.cs_character_promo_drafts where id='00000000-0000-0000-0000-000000000010' for update;
select pg_sleep(4);
commit;
SQL
holder=$!; barrier
PGAPPNAME=persona_dispatch_waiter psql -X -v ON_ERROR_STOP=1 > .persona-dispatch-ci/waited-claim.log <<'SQL' &
select public.assert_ok(public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000002',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is null,'waited request cannot revive old epoch');
SQL
waiter=$!
for _ in $(seq 1 100); do
 [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='persona_dispatch_waiter' and wait_event_type='Lock'")" == 1 ]] && break
 sleep 0.02
done
[[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='persona_dispatch_waiter' and wait_event_type='Lock'")" == 1 ]] || { echo 'Claim did not reach parent lock'; exit 1; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
update cs_promo_private.owners set enabled=false where actor='00000000-0000-0000-0000-000000000002';
update cs_promo_private.owners set enabled=true where actor='00000000-0000-0000-0000-000000000002';
SQL
wait "$holder"; wait "$waiter"
psql -X -v ON_ERROR_STOP=1 -c "select public.assert_ok((select count(*)=0 from cs_promo_private.attempts),'stale caller created no attempt');"
echo 'Actual PostgreSQL caller-claim and waited-epoch races passed.'
