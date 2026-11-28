const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
let PGlite
try { ({ PGlite } = require('@electric-sql/pglite')) } catch (err) {
  if (process.env.REQUIRE_STAGE_REPORT_DB_TEST === '1' || err.code !== 'MODULE_NOT_FOUND') throw err
}

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const active = '2026-12-01T06:00:49Z'
const start = '2026-12-01T06:00:00Z'
const migration = readFileSync(require.resolve('../supabase/migrations/20261128191753_stage_premiere_report_lane.sql'), 'utf8')
const writeGuard = readFileSync(require.resolve('../docs/security/lounge-write-guard.sql'), 'utf8')

test('Stage suppression and the pending queue work with the existing Lounge write guard', {
  skip: PGlite ? false : 'The dedicated browser QA workflow installs and requires the isolated PostgreSQL fixture.',
}, async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql
        as 'select nullif(current_setting(''test.actor'',true),'''')::uuid';
      create table public.profiles (id uuid, display_name text, avatar_url text, is_staff boolean, is_admin boolean);
      create table public.memberships (user_id uuid, tier text, status text, current_period_end timestamptz);
      create table public.lounge_rooms (id uuid primary key, slug text not null);
      create table public.lounge_messages (id uuid primary key, room_id uuid, user_id uuid, is_staff boolean,
        content text, created_at timestamptz, deleted_at timestamptz, deleted_by uuid, author_name text, author_tier text);
      create table public.stage_premiere_reply_moderators (room_id uuid, user_id uuid, expires_at timestamptz);
      create table public.stage_host_questions (id uuid primary key, room_id uuid, host text, answer text, answer_source text);
      create function public.test_clock() returns timestamptz language sql
        as 'select current_setting(''test.clock'')::timestamptz';
    `)
    // Substitute only the external clock in this isolated database. All doors,
    // closing times, ACLs and decision logic remain from the actual migration.
    await db.exec(migration.replaceAll('pg_catalog.clock_timestamp()', 'public.test_clock()'))
    for (const n of [1,2,3,4]) await db.query('insert into auth.users values ($1)', [id(n)])
    await db.query("insert into lounge_rooms values ($1,'ahnika-already-gone'), ($2,'other')", [id(11),id(12)])
    await db.query('insert into stage_premiere_reply_moderators values ($1,$2,$3)', [id(11),id(4),'2026-12-01T06:16:39.700Z'])
    for (const [n, room, name] of [[51,11,'ahnika'],[52,11,'ahnika'],[53,11,'laviche'],[54,12,'ahnika']]) {
      await db.query('insert into stage_host_questions values ($1,$2,$3,null,null)', [id(n),id(room),name])
    }
    for (const [n, room, message, staff] of [
      [20,11,'https://example.invalid/spam',false],[21,11,'https://example.invalid/spam',false],[22,11,'https://example.invalid/spam',false],
      [23,11,'I enjoyed the song',false],[24,12,'https://example.invalid/spam',false],[25,11,'Welcome from staff',true],
      [26,11,'https://example.invalid/once',false],[27,11,'Author will delete this',false],
    ]) await db.query('insert into lounge_messages values ($1,$2,$3,$4,$5,$6,null,null,null,null)', [id(n),id(room),id(1),staff,message,start])
    await db.exec(writeGuard)
    await assert.rejects(db.query('update lounge_messages set deleted_at=now() where id=$1', [id(20)]), /Sign in to write Lounge messages/)
    const clock = value => db.query("select set_config('test.clock',$1,false)", [value])
    const save = async (n, source = 'verified_host') => (await db.query(
      "update stage_host_questions set answer='Reply',answer_source=$2 where id=$1 returning id", [id(n),source])).rows.length
    const report = async (message, reporter = 2, room = 11) => (await db.query(
      'select public.stage_premiere_report_message($1,$2,$3) as result', [id(room),id(message),id(reporter)])).rows[0].result
    const review = async (message, staff, action) => (await db.query(
      'select public.stage_premiere_review_report($1,$2,$3,$4) as result', [id(11),id(message),id(staff),action])).rows[0].result
    const state = async (viewer, room = 11) => (await db.query(
      'select public.stage_premiere_report_state($1,$2) as result', [id(room),id(viewer)])).rows[0].result
    await clock('2026-12-01T05:44:59Z')
    assert.equal(await report(20), 'closed')
    await clock('2026-12-01T05:59:59.999Z')
    assert.equal(await save(51),1)
    await clock('2026-12-01T06:00:00Z')
    assert.equal(await save(52),0)
    assert.equal(await save(53),1)
    assert.equal(await save(54),1)
    assert.equal(await save(52,'moderator'),1)
    await clock('2026-12-01T06:01:39.700Z')
    assert.equal(await save(52),1)
    await clock(active)
    assert.equal(await report(24,2,12), 'closed')
    assert.equal(await report(25), 'closed')
    assert.equal(await report(20,1), 'closed')
    assert.equal(await report(20), 'hidden_by_laviche')
    assert.equal(await report(20), 'hidden_by_laviche')
    assert.equal(await report(23), 'needs_review')
    assert.equal(await report(26), 'needs_review')
    await db.query(`insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
      from generate_series(100,144) n`)
    await db.query(`insert into public.stage_premiere_message_reports(room_id,message_id,reporter_id,created_at,status)
      select $1,$2,id,$3,'needs_review' from auth.users where id >= $4`, [id(11),id(27),start,id(100)])
    await db.query("select set_config('test.actor',$1,false)", [id(1)])
    await db.query('select public.soft_delete_lounge_message($1)', [id(27)])
    await db.query("select set_config('test.actor','',false)")
    assert.deepEqual((await state(4)).pending.map(row => row.id),[id(23),id(26)])
    assert.equal(Object.hasOwn(await state(3),'pending'),false)
    assert.equal(await state(4,12),null)
    assert.equal(await review(23,3,'remove'), false)
    assert.equal(await review(23,4,'remove'), true)
    assert.equal(await review(26,4,'dismiss'), true)
    assert.equal(await report(26,3), 'dismissed')
    const evidence = (await db.query('select id, content, deleted_at, deleted_by from lounge_messages order by id')).rows
    assert.deepEqual(evidence.filter(m => m.deleted_at).map(m => [m.id,m.deleted_by]), [[id(27),id(1)]])
    assert.deepEqual((await state(2)).hidden.sort(),[id(20),id(23)])
    assert.deepEqual((await state(4)).pending,[])
    assert.match(evidence[0].content, /example.invalid/)
    await clock('2026-12-01T06:16:39.700Z')
    assert.equal(await report(21), 'closed')
    assert.equal(await review(26,4,'remove'), false)
    assert.equal(await state(4),null)
    const acl = (await db.query(`select
      has_table_privilege('authenticated','public.stage_premiere_message_reports','SELECT') as reads_reports,
      has_function_privilege('authenticated','public.stage_premiere_report_message(uuid,uuid,uuid)','EXECUTE') as can_report,
      has_function_privilege('anon','public.stage_premiere_review_report(uuid,uuid,uuid,text)','EXECUTE') as can_review,
      has_function_privilege('authenticated','public.stage_premiere_report_state(uuid,uuid)','EXECUTE') as can_read_state,
      has_function_privilege('service_role','public.stage_premiere_report_message(uuid,uuid,uuid)','EXECUTE') as server_can_report`)).rows[0]
    assert.deepEqual(acl,{ reads_reports:false,can_report:false,can_review:false,can_read_state:false,server_can_report:true })
  } finally { await db.close() }
})
