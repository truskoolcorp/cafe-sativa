const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')

function load(path, deps = {}, globals = {}) {
  const src = readFileSync(`${__dirname}/../${path}`, 'utf8')
    .replace(/^import\s+(\{.*?\})\s+from\s+'([^']+)'/gm, (_, bindings, moduleId) =>
      `const ${bindings} = deps[${JSON.stringify(moduleId)}]`)
    .replace(/^export\s+(const|function|async function)\s+([\w]+)(.*)$/gm, (_, type, name, tail) =>
      type === 'const' ? `const ${name} = exports.${name}${tail}` : `exports.${name} = ${type} ${name}${tail}`)
  const context = { exports: {}, deps, AbortSignal, Headers, Request, Response, URL, ...globals }
  runInNewContext(stripTypeScriptTypes(src), context)
  return context.exports
}
const lobby = load('lib/events/stage-lobby.ts')
const event = load('lib/events/ahnika-premiere-window.ts', { './stage-lobby': lobby })
const slots = load('lib/events/private-stage-rehearsal.ts', { './ahnika-premiere-window': event })
const start = '2026-11-25T19:00:00Z'
const env = { VERCEL_ENV: 'production', STAGE_PRIVATE_REHEARSAL_ENABLED: 'true', STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT: start }
const slot = slots.privateStagePlaybackSlot(env)
const iso = millis => new Date(millis).toISOString().replace('.000Z', 'Z')

test('production requires its own one-off slot and cannot overlap the public doors', () => {
  assert.equal(slot.start, Date.parse(start))
  assert.equal(slot.end, slot.start + 60 * 60_000)
  assert.equal(slot.onDemand, true)
  const preview = slots.privateStagePlaybackSlot({ ...env, VERCEL_ENV: 'preview', STAGE_PRIVATE_REHEARSAL_STARTS_AT: start })
  assert.equal(preview.end - preview.start, event.AHNIKA_PREMIERE_DURATION_MS)
  assert.equal(preview.onDemand, false)
  assert.equal(slot.inviteUntil, slot.end + 30 * 60_000)
  assert.equal(slots.privateStagePlaybackSlot({ ...env, STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT: undefined,
    STAGE_PRIVATE_REHEARSAL_STARTS_AT: start }), null)
  assert.equal(slots.privateStagePlaybackSlot({ ...env, VERCEL_ENV: 'preview' }), null)
  assert.equal(slots.privateStagePlaybackSlot({ ...env, STAGE_PRIVATE_REHEARSAL_ENABLED: 'false' }), null)
  assert.equal(slots.privateStagePlaybackSlot({ ...env, STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT: iso(event.AHNIKA_AUDIENCE_SCHEDULE.doors - 20 * 60_000) }), null)
  assert.equal(slots.privateStagePlaybackSlot({ ...env, STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT: '2026-11-31T19:00:00Z' }), null)
})

test('production media requires a short-lived signed-in invitation through cutoff', async () => {
  for (const mode of ['signed_out', 'anonymous', 'uninvited', 'too_short', 'too_long', 'completed', 'valid', 'late_seek']) {
    const now = mode === 'completed' ? slot.end : mode === 'late_seek' ? slot.end - 1000 : slot.start
    class SlotDate extends Date { static now() { return now } }
    let upstream = 0
    const media = load('lib/events/ahnika-premiere-media.ts', { './ahnika-premiere-window': event }, { Date: SlotDate })
    const src = 'https://ekaukffotzujkkpdvpgj.supabase.co'
    const path = `${src}/storage/v1/object/sign/cafe-sativa-content/Ahnika_Merlot_Cafe_Sativa_Stage_Premiere_Cut.mp4?token=fixture`
    const expiry = mode === 'too_short' ? slot.end - 1 : mode === 'too_long' ? slot.inviteUntil + 1 : slot.inviteUntil
    const route = load('app/api/stage/rehearsal-media/route.ts', {
      '@/lib/events/private-stage-rehearsal': slots,
      '@/lib/events/ahnika-premiere-window': event,
      '@/lib/events/ahnika-premiere-media': media,
      '@/lib/supabase/server': { createClient: () => ({
        auth: { getUser: async () => ({ data: { user: mode === 'signed_out' ? null : { id: 'fixture', is_anonymous: mode === 'anonymous' } } }) },
        from(table) {
          const chain = { select: () => chain, eq: () => chain, gt: () => chain, maybeSingle: async () => ({
            data: table === 'stage_rehearsal_invites'
              ? mode === 'uninvited' ? null : { expires_at: new Date(expiry).toISOString() }
              : { starts_at: event.AHNIKA_PREMIERE_START, status: 'scheduled', presenter_name: 'Ahnika Merlot', ticket_price_cents: 0 },
          }) }
          return chain
        },
      }) },
    }, { Date: SlotDate, process: { env: { ...env, STAGE_RELEASE_MEDIA_RELAY_URL: src + '/functions/v1/cafe-sativa-stage-canary',
      STAGE_RELEASE_MEDIA_RELAY_KEY: 'fixture-only' } },
    fetch: async url => {
      upstream++
      return url.pathname.startsWith('/functions/') ? Response.json({ url: path }) :
        new Response('a', { status: 206, headers: { 'Content-Range': 'bytes 0-0/1' } })
    } })
    const request = new Request('https://www.cafe-sativa.com/api/stage/rehearsal-media', { headers: { range: 'bytes=0-0' } })
    const result = await route.GET(request)
    const allowed = mode === 'valid' || mode === 'late_seek'
    assert.equal(result.status, allowed ? 206 : 404, mode)
    assert.equal(upstream, allowed ? 2 : 0, mode)
    assert.equal(result.headers.get('location'), null)
    assert.match(result.headers.get('cache-control'), /no-store/)
    const publicResult = await media.serveAhnikaPremiereMedia(request, { now: () => slot.start, fetch: async () => {
      throw Error('Public media cannot be fetched during a private slot')
    } })
    assert.equal(publicResult.status, 404)
  }
})
