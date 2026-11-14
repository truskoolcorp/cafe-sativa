#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || exit 1
cd "$(dirname "$0")/../.."
export PGDATABASE="persona_watermark_fixture_${RANDOM}_$$"
createdb "$PGDATABASE"
trap 'dropdb "$PGDATABASE"' EXIT
psql -X -v ON_ERROR_STOP=1 -f tests/sql/persona-ledger-fixture.sql
for file in supabase/migrations/20261020154000_character_canon_spoken_promos.sql supabase/migrations/20261020173000_character_promo_qa_checks.sql supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql docs/proposals/persona-delivery-ledger.sql tests/sql/persona-gates-seed.sql docs/proposals/persona-approval-gates.sql docs/proposals/persona-owner-revocation.sql docs/proposals/persona-qa-observation.sql docs/proposals/persona-watermark-qa.sql tests/sql/persona-watermark-tests.sql; do
 psql -X -v ON_ERROR_STOP=1 -f "$file"
done
