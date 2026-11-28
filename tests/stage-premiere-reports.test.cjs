const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const active = '2026-12-01T06:00:49Z'
const start = '2026-12-01T06:00:00Z'
const migration = readFileSync(require.resolve('../supabase/migrations/20261128191753_stage_premiere_report_lane.sql'), 'utf8')

test('an isolated clock proves the real report SQL closes on time, auto-hides only repeated links, and requires staff review otherwise', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create table public.lounge_rooms (id uuid primary key, slug text not null);
      create table public.lounge_messages (id uuid primary key, room_id uuid, user_id uuid, is_staff boolean,
        content text, created_at timestamptz, deleted_at timestamptz, deleted_by uuid);
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
      [26,11,'https://example.invalid/once',false],
    ]) await db.query('insert into lounge_messages values ($1,$2,$3,$4,$5,$6,null,null)', [id(n),id(room),id(1),staff,message,start])
    const clock = value => db.query("select set_config('test.clock',$1,false)", [value])
    const save = async (n, source = 'verified_host') => (await db.query(
      "update stage_host_questions set answer='Reply',answer_source=$2 where id=$1 returning id", [id(n),source])).rows.length
    const report = async (message, reporter = 2, room = 11) => (await db.query(
      'select public.stage_premiere_report_message($1,$2,$3) as result', [id(room),id(message),id(reporter)])).rows[0].result
    const review = async (message, staff, action) => (await db.query(
      'select public.stage_premiere_review_report($1,$2,$3,$4) as result', [id(11),id(message),id(staff),action])).rows[0].result
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
    assert.equal(await review(23,3,'remove'), false)
    assert.equal(await review(23,4,'remove'), true)
    assert.equal(await review(26,4,'dismiss'), true)
    assert.equal(await report(26,3), 'dismissed')
    const evidence = (await db.query('select id, content, deleted_at, deleted_by from lounge_messages order by id')).rows
    assert.deepEqual(evidence.filter(m => m.deleted_at).map(m => [m.id,m.deleted_by]), [[id(20),null],[id(23),id(4)]])
    assert.match(evidence[0].content, /example.invalid/)
    await clock('2026-12-01T06:16:39.700Z')
    assert.equal(await report(21), 'closed')
    assert.equal(await review(26,4,'remove'), false)
    const acl = (await db.query(`select
      has_table_privilege('authenticated','public.stage_premiere_message_reports','SELECT') as reads_reports,
      has_function_privilege('authenticated','public.stage_premiere_report_message(uuid,uuid,uuid)','EXECUTE') as can_report,
      has_function_privilege('anon','public.stage_premiere_review_report(uuid,uuid,uuid,text)','EXECUTE') as can_review,
      has_function_privilege('service_role','public.stage_premiere_report_message(uuid,uuid,uuid)','EXECUTE') as server_can_report`)).rows[0]
    assert.deepEqual(acl,{ reads_reports:false,can_report:false,can_review:false,server_can_report:true })
  } finally { await db.close() }
})
