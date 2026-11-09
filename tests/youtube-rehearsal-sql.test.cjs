// Executes actual PostgreSQL DDL/PLpgSQL through the optional PGlite fixture.
// PGLITE_MODULE must point to an installed official @electric-sql/pglite package.
// This never uses a database URL, network connection or production credentials.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
let PGlite
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')) } catch {}
const sql = fs.readFileSync('supabase/migrations/20261109181000_youtube_private_rehearsal.sql', 'utf8')
const END = '2026-11-11T06:30:00Z'
const skip = PGlite ? false : 'Install @electric-sql/pglite or set PGLITE_MODULE to its local package path'
async function create(dataDir) {
  const db = new PGlite(dataDir)
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
  await db.exec(sql)
  return db
}
async function call(db) {
  return (await db.query('SELECT public.cs_reserve_youtube_rehearsal() AS allowed')).rows[0].allowed
}
async function testClock(db, at) {
  // Test-only overlay into an isolated WASM database. Production RPC still uses
  // clock_timestamp() AFTER its row lock and has no arguments or clock setting.
  const original = (await db.query("SELECT pg_get_functiondef('public.cs_reserve_youtube_rehearsal()'::regprocedure) AS definition")).rows[0].definition
  assert.match(original, /at_time := clock_timestamp\(\);/)
  await db.exec(original.replace('at_time := clock_timestamp();', "at_time := current_setting('test.rehearsal_now')::timestamptz;"))
  await db.query("SELECT set_config('test.rehearsal_now', $1, false)", [at])
}

test('rehearsal SQL is separate, no-argument, clock-bound, nonrefillable and content-free', () => {
  assert.match(sql, /CREATE FUNCTION public\.cs_reserve_youtube_rehearsal\(\)/)
  assert.match(sql, /FOR UPDATE;[\s\S]*at_time := clock_timestamp\(\);/)
  assert.match(sql, /at_time >= '2026-11-11T06:30:00Z'/)
  assert.match(sql, /fixture_runs IN \(0, 2\)/)
  assert.match(sql, /fixture_runs = 2, claimed_at = at_time/)
  assert.match(sql, /BEFORE UPDATE OR DELETE/); assert.match(sql, /BEFORE TRUNCATE/)
  assert.match(sql, /REVOKE ALL ON public\.cs_youtube_rehearsal_budget FROM PUBLIC, anon, authenticated, service_role/)
  assert.doesNotMatch(sql, /cs_youtube_generation_|ON CONFLICT|p_now|p_clock|source_message_id|review_sha|generated_text/)
})

test('unmodified production migration compiles in PostgreSQL and only service_role can claim, never inspect/reset', { skip }, async () => {
  const db = await create()
  try {
    const permissions = (await db.query(`SELECT
      has_table_privilege('service_role', 'public.cs_youtube_rehearsal_budget', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS tables,
      has_function_privilege('service_role', 'public.cs_reserve_youtube_rehearsal()', 'EXECUTE') AS service,
      has_function_privilege('anon', 'public.cs_reserve_youtube_rehearsal()', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.cs_reserve_youtube_rehearsal()', 'EXECUTE') AS authenticated,
      has_function_privilege('service_role', 'public.cs_youtube_rehearsal_no_refill()', 'EXECUTE') AS guard,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cs_youtube_rehearsal_budget'::regclass) AS rls`)).rows[0]
    assert.deepEqual(permissions, { tables: false, service: true, anon: false, authenticated: false, guard: false, rls: true })
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(call(db), /permission denied/)
      await db.exec('RESET ROLE')
    }
    const beforeEnd = (await db.query('SELECT clock_timestamp() < $1::timestamptz AS before_end', [END])).rows[0].before_end
    await db.exec('SET ROLE service_role')
    const claims = await Promise.all(Array.from({ length: 6 }, () => call(db)))
    assert.equal(claims.filter(Boolean).length, beforeEnd ? 1 : 0)
    await assert.rejects(db.query('SELECT * FROM public.cs_youtube_rehearsal_budget'), /permission denied/)
    await assert.rejects(db.exec('UPDATE public.cs_youtube_rehearsal_budget SET fixture_runs = 0, claimed_at = NULL'), /permission denied/)
    await db.exec('RESET ROLE')
    const row = (await db.query('SELECT fixture_runs, claimed_at FROM public.cs_youtube_rehearsal_budget')).rows[0]
    assert.equal(row.fixture_runs, beforeEnd ? 2 : 0)
    if (beforeEnd) assert.ok(row.claimed_at)
    await assert.rejects(db.exec('UPDATE public.cs_youtube_rehearsal_budget SET fixture_runs = 0, claimed_at = NULL'), /rehearsal_budget_immutable/)
    await assert.rejects(db.exec('DELETE FROM public.cs_youtube_rehearsal_budget'), /rehearsal_budget_immutable/)
    await assert.rejects(db.exec('TRUNCATE public.cs_youtube_rehearsal_budget'), /rehearsal_budget_immutable/)
    await assert.rejects(db.exec("INSERT INTO public.cs_youtube_rehearsal_budget(event_id) VALUES ('00000000-0000-0000-0000-000000000000')"), /check constraint/)
  } finally { await db.close() }
})

test('SQL rejects exact end and after-end without consuming; before-end can consume only once', { skip }, async () => {
  const db = await create()
  try {
    await testClock(db, END)
    assert.equal(await call(db), false)
    await db.query("SELECT set_config('test.rehearsal_now', $1, false)", ['2026-11-11T06:30:00.001Z'])
    assert.equal(await call(db), false)
    assert.equal((await db.query('SELECT fixture_runs FROM public.cs_youtube_rehearsal_budget')).rows[0].fixture_runs, 0)
    await db.query("SELECT set_config('test.rehearsal_now', $1, false)", ['2026-11-09T18:00:00Z'])
    assert.equal(await call(db), true)
    assert.equal(await call(db), false)
    await db.query("SELECT set_config('test.rehearsal_now', $1, false)", ['2026-11-08T18:00:00Z'])
    assert.equal(await call(db), false)
    assert.equal((await db.query('SELECT fixture_runs FROM public.cs_youtube_rehearsal_budget')).rows[0].fixture_runs, 2)
  } finally { await db.close() }
})

test('committed SQL budget survives process/database restart and simulated post-reservation crash', { skip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-rehearsal-sql-'))
  let db
  try {
    db = await create(dataDir)
    await testClock(db, '2026-11-09T18:00:00Z')
    assert.equal(await call(db), true)
    // Provider never begins, simulating a crash immediately after committed RPC.
    await db.close(); db = new PGlite(dataDir)
    await db.query("SELECT set_config('test.rehearsal_now', $1, false)", ['2026-11-09T18:00:01Z'])
    assert.equal(await call(db), false)
    const row = (await db.query('SELECT fixture_runs FROM public.cs_youtube_rehearsal_budget')).rows[0]
    assert.equal(row.fixture_runs, 2)
  } finally {
    if (db) await db.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
