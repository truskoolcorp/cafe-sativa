// Real PostgreSQL DDL/RPC tests in isolated PGlite. No network or production DB.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
let PGlite
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')) } catch {}
const skip = PGlite ? false : 'Set PGLITE_MODULE to an installed official @electric-sql/pglite package'
const originalSql = fs.readFileSync('supabase/migrations/20261109181000_youtube_private_rehearsal.sql', 'utf8')
const liveSql = fs.readFileSync('supabase/migrations/20261109180000_youtube_generation_quota.sql', 'utf8')
const sql = fs.readFileSync('supabase/migrations/20261109200000_youtube_private_rehearsal_v2.sql', 'utf8')
async function create(dataDir) {
  const db = new PGlite(dataDir)
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
  await db.exec(liveSql); await db.exec(originalSql); await db.exec(sql)
  return db
}
async function call(db, version = 2) {
  return (await db.query(`SELECT public.cs_reserve_youtube_rehearsal${version === 2 ? '_v2' : ''}() AS allowed`)).rows[0].allowed
}
async function clock(db, version, at) {
  // Isolated test-only clock overlay. Neither production function accepts a
  // clock, settings, target, fixture count, model or any other caller argument.
  const name = `public.cs_reserve_youtube_rehearsal${version === 2 ? '_v2' : ''}()`
  const definition = (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [name])).rows[0].definition
  if (definition.includes('at_time := clock_timestamp();')) {
    await db.exec(definition.replace('at_time := clock_timestamp();', `at_time := current_setting('test.rehearsal_${version}_now')::timestamptz;`))
  }
  await db.query('SELECT set_config($1, $2, false)', [`test.rehearsal_${version}_now`, at])
}
async function existingBudgets(db) {
  return (await db.query(`SELECT
    (SELECT row_to_json(b) FROM public.cs_youtube_rehearsal_budget b) AS original,
    (SELECT row_to_json(b) FROM public.cs_youtube_generation_budget b) AS live`)).rows[0]
}

test('v2 SQL creates a separate permanent batch, reads but never refills v1, and never touches live quota', () => {
  assert.match(sql, /CREATE FUNCTION public\.cs_reserve_youtube_rehearsal_v2\(\)/)
  assert.match(sql, /fixture_runs IN \(0, 2\)/)
  assert.match(sql, /FROM public\.cs_youtube_rehearsal_budget[\s\S]*fixture_runs = 2/)
  assert.match(sql, /FOR UPDATE;[\s\S]*at_time := clock_timestamp\(\);/)
  assert.match(sql, /at_time >= '2026-11-11T06:30:00Z'/)
  assert.match(sql, /BEFORE UPDATE OR DELETE/); assert.match(sql, /BEFORE TRUNCATE/)
  assert.doesNotMatch(sql, /(?:UPDATE|INSERT INTO|DELETE FROM|TRUNCATE|ALTER TABLE|CREATE TABLE) public\.cs_youtube_rehearsal_budget\b/)
  assert.doesNotMatch(sql, /cs_youtube_generation_|ON CONFLICT|p_now|p_clock|source_message|generated_text/)
})

test('unmodified v2 migration compiles and only a consumed original permits its single separate service-role claim', { skip }, async () => {
  const db = await create()
  try {
    const unused = await existingBudgets(db)
    assert.equal(await call(db), false)
    assert.deepEqual(await existingBudgets(db), unused)
    await clock(db, 1, '2026-11-09T18:00:00Z')
    assert.equal(await call(db, 1), true)
    const originalConsumed = await existingBudgets(db)
    assert.equal(originalConsumed.original.fixture_runs, 2); assert.equal(originalConsumed.live.attempts, 0)
    const permissions = (await db.query(`SELECT
      has_table_privilege('service_role', 'public.cs_youtube_rehearsal_v2_budget', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS tables,
      has_function_privilege('service_role', 'public.cs_reserve_youtube_rehearsal_v2()', 'EXECUTE') AS service,
      has_function_privilege('anon', 'public.cs_reserve_youtube_rehearsal_v2()', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.cs_reserve_youtube_rehearsal_v2()', 'EXECUTE') AS authenticated,
      has_function_privilege('service_role', 'public.cs_youtube_rehearsal_v2_no_refill()', 'EXECUTE') AS guard,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cs_youtube_rehearsal_v2_budget'::regclass) AS rls`)).rows[0]
    assert.deepEqual(permissions, { tables: false, service: true, anon: false, authenticated: false, guard: false, rls: true })
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`); await assert.rejects(call(db), /permission denied/); await db.exec('RESET ROLE')
    }
    const beforeEnd = (await db.query("SELECT clock_timestamp() < '2026-11-11T06:30:00Z'::timestamptz AS before_end")).rows[0].before_end
    await db.exec('SET ROLE service_role')
    const claims = await Promise.all(Array.from({ length: 8 }, () => call(db)))
    assert.equal(claims.filter(Boolean).length, beforeEnd ? 1 : 0)
    await assert.rejects(db.query('SELECT * FROM public.cs_youtube_rehearsal_v2_budget'), /permission denied/)
    await assert.rejects(db.exec('UPDATE public.cs_youtube_rehearsal_v2_budget SET fixture_runs = 0, claimed_at = NULL'), /permission denied/)
    await db.exec('RESET ROLE')
    assert.deepEqual(await existingBudgets(db), originalConsumed)
    await assert.rejects(db.exec('UPDATE public.cs_youtube_rehearsal_v2_budget SET fixture_runs = 0, claimed_at = NULL'), /rehearsal_budget_immutable/)
    await assert.rejects(db.exec('DELETE FROM public.cs_youtube_rehearsal_v2_budget'), /rehearsal_budget_immutable/)
    await assert.rejects(db.exec('TRUNCATE public.cs_youtube_rehearsal_v2_budget'), /rehearsal_budget_immutable/)
    await assert.rejects(db.exec('UPDATE public.cs_youtube_rehearsal_budget SET fixture_runs = 0, claimed_at = NULL'), /rehearsal_budget_immutable/)
    assert.deepEqual(await existingBudgets(db), originalConsumed)
  } finally { await db.close() }
})

test('v2 exact-end and after-end RPC refuses without spending; pre-end spent batch never refills', { skip }, async () => {
  const db = await create()
  try {
    await clock(db, 1, '2026-11-09T18:00:00Z'); assert.equal(await call(db, 1), true)
    const before = await existingBudgets(db)
    for (const at of ['2026-11-11T06:30:00Z', '2026-11-11T06:30:00.001Z']) {
      await clock(db, 2, at); assert.equal(await call(db), false)
      assert.equal((await db.query('SELECT fixture_runs FROM public.cs_youtube_rehearsal_v2_budget')).rows[0].fixture_runs, 0)
    }
    await clock(db, 2, '2026-11-09T18:01:00Z'); assert.equal(await call(db), true)
    await clock(db, 2, '2026-11-09T18:00:00Z'); assert.equal(await call(db), false)
    assert.equal((await db.query('SELECT fixture_runs FROM public.cs_youtube_rehearsal_v2_budget')).rows[0].fixture_runs, 2)
    assert.deepEqual(await existingBudgets(db), before)
  } finally { await db.close() }
})

test('v2 consumed batch survives database restart/crash while original and live budgets remain unchanged', { skip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-rehearsal-v2-sql-'))
  let db
  try {
    db = await create(dataDir)
    await clock(db, 1, '2026-11-09T18:00:00Z'); assert.equal(await call(db, 1), true)
    await clock(db, 2, '2026-11-09T18:01:00Z'); assert.equal(await call(db), true)
    const before = await existingBudgets(db)
    await db.close(); db = new PGlite(dataDir)
    await clock(db, 2, '2026-11-09T18:02:00Z'); assert.equal(await call(db), false)
    assert.deepEqual(await existingBudgets(db), before)
    assert.equal((await db.query('SELECT fixture_runs FROM public.cs_youtube_rehearsal_v2_budget')).rows[0].fixture_runs, 2)
  } finally { if (db) await db.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
