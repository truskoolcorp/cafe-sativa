#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == postgres ]] || exit 1
cd "$(dirname "$0")/../.."
export PGDATABASE="venue_watermark_fixture_${RANDOM}_$$"
createdb "$PGDATABASE"
trap 'dropdb "$PGDATABASE"' EXIT
for file in tests/sql/venue-watermark-fixture.sql docs/proposals/venue-watermark-reviews.sql tests/sql/venue-watermark-tests.sql; do psql -X -v ON_ERROR_STOP=1 -f "$file";done
