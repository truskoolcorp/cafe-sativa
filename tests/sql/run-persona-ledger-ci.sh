#!/usr/bin/env bash
set -euo pipefail
# Dedicated disposable CI service only, never production or application DATABASE_URL.
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || { echo 'Requires isolated localhost CI PostgreSQL'; exit 1; }
cd "$(dirname "$0")/../.."
setup() {
  export PGDATABASE="persona_ledger_fixture_$1"
  createdb "$PGDATABASE"
  psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-fixture.sql
  psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261020154000_character_canon_spoken_promos.sql
  psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261020173000_character_promo_qa_checks.sql
  psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql
  psql -X -v ON_ERROR_STOP=1 -f docs/proposals/persona-delivery-ledger.sql
  psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-tests.sql
}
setup claims
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-isolation.sql
# First transaction deliberately holds parent lock. Concurrent second claim must wait,
# then return NULL. Two true claims cannot be hidden by merely counting unique rows.
PGAPPNAME=persona_claim_first psql -X -v ON_ERROR_STOP=1 > /tmp/persona-claim-first.log <<'SQL' &
begin;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is not null,'first claim wins') from fixture_snapshot;
select pg_sleep(2);
commit;
SQL
first=$!
for _ in $(seq 1 50); do
  [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name in ('persona_claim_first','persona_edit_first') and wait_event='PgSleep'")" == 1 ]] && break
  sleep 0.02
done
[[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name in ('persona_claim_first','persona_edit_first') and wait_event='PgSleep'")" == 1 ]] || { echo 'Race barrier not reached'; exit 1; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'concurrent claim loses') from fixture_snapshot;
SQL
wait "$first"
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-after-claim.sql
# Roles are cluster-global; fixture bootstrap for second database tolerates only existing roles.
export PGDATABASE=persona_ledger_fixture_edits
createdb "$PGDATABASE"
sed '/^create role /d' tests/sql/persona-ledger-fixture.sql | psql -X -v ON_ERROR_STOP=1
for file in supabase/migrations/20261020154000_character_canon_spoken_promos.sql supabase/migrations/20261020173000_character_promo_qa_checks.sql supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql docs/proposals/persona-delivery-ledger.sql tests/sql/persona-ledger-tests.sql; do psql -X -v ON_ERROR_STOP=1 -f "$file"; done
PGAPPNAME=persona_edit_first psql -X -v ON_ERROR_STOP=1 > /tmp/persona-edit-first.log <<'SQL' &
begin;
update public.cs_character_promo_qa_checks set evidence='new review evidence' where check_name='rights';
select pg_sleep(2);
commit;
SQL
first=$!
for _ in $(seq 1 50); do
  [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name in ('persona_claim_first','persona_edit_first') and wait_event='PgSleep'")" == 1 ]] && break
  sleep 0.02
done
[[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name in ('persona_claim_first','persona_edit_first') and wait_event='PgSleep'")" == 1 ]] || { echo 'Race barrier not reached'; exit 1; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'concurrent stale QA rejected') from fixture_snapshot;
SQL
wait "$first"
echo 'Real PostgreSQL sequential and multi-session fixture checks passed.'
