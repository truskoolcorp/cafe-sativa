// Isolated Postgres fixture; it is not part of the default app test glob.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')

const migration = fs.readFileSync('supabase/migrations/20261123131346_stage_dress_report_lane.sql', 'utf8')
const room = '5cafe000-0000-4000-8000-000000000001'
const other = '5cafe000-0000-4000-8000-000000000002'
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0')
const [viewer, sender, staff, outsider, viewer2] = [1, 2, 3, 4, 5].map(id)

test('room-only Laviche spam suppression, human-only review, and closed-window denial', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create table public.stage_rehearsal_invites (user_id uuid primary key, expires_at timestamptz, can_draft boolean);
      create table public.lounge_messages (id uuid primary key, room_id uuid, user_id uuid, is_staff boolean default false, content text, created_at timestamptz, deleted_at timestamptz);
      grant usage on schema public to service_role;
      grant select,update on public.lounge_messages to service_role;
      grant select on public.stage_rehearsal_invites to service_role;
    `)
    const { rows: [clock] } = await db.query(`
      select (now() - interval '5 minutes')::text doors, (now() + interval '15 minutes')::text closes,
             (now() + interval '20 minutes')::text expires
    `)
    // The deployed SQL is locked to one date. Substitute a local fixture clock
    // only in this in-memory database; the real migration is never rewritten.
    const fixture = migration
      .replaceAll('2026-11-24T13:45:00Z', clock.doors)
      .replaceAll('2026-11-24T14:16:39.700Z', clock.closes)
      .replaceAll('2026-11-24T14:20:00Z', clock.expires)
    await db.exec(fixture)
    for (const person of [viewer, sender, staff, outsider, viewer2]) {
      await db.query('insert into auth.users values ($1)', [person])
      if (person !== outsider) await db.query('insert into public.stage_rehearsal_invites values ($1,$2,$3)', [person, clock.expires, person === staff])
    }
    const add = (n, where, author, content, isStaff = false) => db.query(
      "insert into public.lounge_messages values ($1,$2,$3,$4,$5,now() - interval '1 second',null)",
      [id(n), where, author, isStaff, content])
    for (const n of [11, 12, 13]) await add(n, room, sender, 'Example duplicate https://example.invalid')
    await add(14, room, sender, 'We had fun tonight.')
    await add(15, other, sender, 'Example duplicate https://example.invalid')
    await add(16, room, staff, 'Example duplicate https://example.invalid', true)
    await add(17, room, viewer, 'A normal message of my own.')
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select public.stage_dress_report_message($1,$2)', [id(11), viewer]), /permission denied/)
    await assert.rejects(db.query('select * from public.stage_dress_message_reports'), /permission denied/)
    await db.exec('reset role; set role service_role')
    async function report(n, by) {
      return (await db.query('select public.stage_dress_report_message($1,$2) as result', [id(n), by])).rows[0].result
    }
    async function review(n, by, action) {
      return (await db.query('select public.stage_dress_review_report($1,$2,$3) as result', [id(n), by, action])).rows[0].result
    }
    assert.equal(await report(15, viewer), 'closed')
    assert.equal(await report(16, viewer), 'closed')
    assert.equal(await report(17, viewer), 'closed')
    assert.equal(await report(11, outsider), 'closed')
    assert.equal(await report(11, viewer), 'hidden_by_laviche')
    assert.equal(await report(11, viewer), 'hidden_by_laviche')
    assert.equal(await report(11, viewer2), 'hidden_by_laviche')
    assert.equal(await report(14, viewer), 'needs_review')
    assert.equal(await review(14, viewer, 'remove'), false)
    assert.equal(await review(14, staff, 'remove'), true)
    assert.equal(await report(14, viewer2), 'hidden_by_staff')
    assert.equal(await review(14, staff, 'remove'), false)
    const { rows } = await db.query('select status, count(*)::integer as n from public.stage_dress_message_reports group by status order by status')
    assert.deepEqual(rows, [{ status: 'hidden_by_laviche', n: 2 }, { status: 'hidden_by_staff', n: 2 }])
    assert.equal((await db.query('select deleted_at from public.lounge_messages where id = $1',[id(11)])).rows[0].deleted_at, null)
    await db.exec('reset role')
    // Replace only these functions with their production clock. Production
    // windows and invitation times never accept fixture callers.
    const functions = migration.slice(migration.indexOf('create function public.stage_dress_report_message'))
      .replaceAll('create function', 'create or replace function')
    await db.exec(functions)
    assert.equal(await report(12, viewer), 'closed')
  } finally {
    await db.close()
  }
})
