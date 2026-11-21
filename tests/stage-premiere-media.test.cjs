const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(name, imports = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(name.endsWith('.ts') ? name : `lib/events/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(code, { exports, require: name => imports[name], Request, Response, Headers, URL, AbortSignal, Date,
    process: { env: imports.env || {} }, fetch: imports.fetch })
  return exports
}
const windowState = load('ahnika-premiere-window', { './stage-lobby': load('stage-lobby') })
const media = load('ahnika-premiere-media', { './ahnika-premiere-window': windowState })
const { serveAhnikaPremiereMedia, servePrivateAhnikaCut } = media
const privateStage = load('private-stage-rehearsal', { './ahnika-premiere-window': windowState })
const origin = 'https://ekaukffotzujkkpdvpgj.supabase.co'
const relayUrl = origin + '/functions/v1/cafe-sativa-stage-canary'
const storageUrl = origin + '/storage/v1/object/sign/cafe-sativa-content/Ahnika_Merlot_Cafe_Sativa_Stage_Premiere_Cut.mp4?token=private-fixture'
const clock = Date.parse(windowState.AHNIKA_PREMIERE_START)

function fixture(options = {}) {
  const fetches = []
  let queries = 0
  const dependencies = {
    relayUrl, key: 'authorized-fixture',
    now: () => options.now ?? clock,
    canonical: async () => { queries++; return options.canonical ?? true },
    fetch: async (url, init) => {
      fetches.push({ url: url.href, init })
      if (fetches.length === 1) return Response.json({ url: options.url ?? storageUrl })
      const partial = init.headers.Range
      return new Response('abc', {
        status: options.status ?? (partial ? 206 : 200),
        headers: { 'Content-Length': '3', 'Content-Range': partial ? 'bytes 0-2/99' : '', 'Set-Cookie': 'internal=hidden' },
      })
    },
  }
  return { fetches, queries: () => queries, serve: range =>
    serveAhnikaPremiereMedia(new Request('https://www.cafe-sativa.com/api/events/ahnika-premiere', { headers: range ? { range } : {} }), dependencies) }
}

test('before kickoff and from the exact end onward: no signer, media, or canonical lookup', async () => {
  for (const now of [clock - 1, windowState.AHNIKA_PREMIERE_END, windowState.AHNIKA_PREMIERE_END + 1000]) {
    const f = fixture({ now })
    const response = await f.serve('bytes=0-2')
    assert.equal(response.status, 404)
    assert.equal(f.fetches.length, 0)
    assert.equal(f.queries(), 0)
    assert.match(response.headers.get('Cache-Control'), /no-store/)
  }
})

test('approved premiere forwards a single media range without leaking storage credentials', async () => {
  const f = fixture()
  const r = await f.serve('bytes=0-2')
  assert.equal(r.status, 206)
  assert.equal(await r.text(), 'abc')
  assert.equal(r.headers.get('content-range'), 'bytes 0-2/99')
  assert.equal(r.headers.get('location'), null)
  assert.equal(r.headers.get('set-cookie'), null)
  assert.equal(f.fetches[0].init.headers['x-canary-key'], 'authorized-fixture')
  assert.equal(f.fetches[1].init.headers.Range, 'bytes=0-2')
  assert.equal(f.fetches[1].init.headers['x-canary-key'], undefined)
})

test('malformed range, noncanonical event, untrusted signer location and bad range response fail closed', async () => {
  const malformed = fixture()
  assert.equal((await malformed.serve('bytes=0-1,4-5')).status, 416)
  assert.equal(malformed.fetches.length, 0)
  const canceled = fixture({ canonical: false })
  assert.equal((await canceled.serve()).status, 404)
  assert.equal(canceled.fetches.length, 0)
  const wrongSource = fixture({ url: 'https://example.com/other.mp4?token=wrong' })
  assert.equal((await wrongSource.serve()).status, 503)
  assert.equal(wrongSource.fetches.length, 1)
  assert.equal((await fixture({ status: 200 }).serve('bytes=0-2')).status, 503)
})

test('private playback slot is preview-only, requires the explicit flag and a valid fixed UTC time', () => {
  const env = { VERCEL_ENV: 'preview', STAGE_PRIVATE_REHEARSAL_ENABLED: 'true', STAGE_PRIVATE_REHEARSAL_STARTS_AT: '2026-11-25T19:00:00Z' }
  const slot = privateStage.privateStagePlaybackSlot(env)
  assert.equal(slot.end - slot.start, windowState.AHNIKA_PREMIERE_DURATION_MS)
  assert.equal(privateStage.rehearsalInviteCoversCut(new Date(slot.end).toISOString(), slot.end), true)
  assert.equal(privateStage.rehearsalInviteCoversCut(new Date(slot.end - 1).toISOString(), slot.end), false)
  for (const override of [{ VERCEL_ENV: 'production' }, { STAGE_PRIVATE_REHEARSAL_ENABLED: 'false' }, { STAGE_PRIVATE_REHEARSAL_STARTS_AT: '2026-11-31T19:00:00Z' }, { STAGE_PRIVATE_REHEARSAL_STARTS_AT: '2026-11-25T19:00:00' }]) {
    assert.equal(privateStage.privateStagePlaybackSlot({ ...env, ...override }), null)
  }
})

test('rehearsal media route requires nonanonymous invited access covering the entire cut', async () => {
  const start = new Date(Date.now() - 1000).toISOString().replace(/\.\d+Z$/, 'Z')
  const end = Date.parse(start) + windowState.AHNIKA_PREMIERE_DURATION_MS
  const env = { VERCEL_ENV: 'preview', STAGE_PRIVATE_REHEARSAL_ENABLED: 'true', STAGE_PRIVATE_REHEARSAL_STARTS_AT: start,
    STAGE_RELEASE_MEDIA_RELAY_URL: relayUrl, STAGE_RELEASE_MEDIA_RELAY_KEY: 'fixture' }
  const url = new URL('https://preview.example/api/stage/rehearsal-media?startsAt=ignored')
  for (const mode of ['disabled', 'anonymous', 'not_invited', 'expires_mid_cut', 'valid']) {
    let lookups = 0
    let upstream = 0
    const opts = {
      env: mode === 'disabled' ? { ...env, VERCEL_ENV: 'production' } : env,
      '@/lib/events/private-stage-rehearsal': privateStage,
      '@/lib/events/ahnika-premiere-window': windowState,
      '@/lib/events/ahnika-premiere-media': { servePrivateAhnikaCut },
      '@/lib/supabase/server': { createClient: () => {
        lookups++
        return {
          auth: { getUser: async () => ({ data: { user: { id:'fixture', is_anonymous: mode === 'anonymous' } } }) },
          from: table => {
            const mock = { select: () => mock, eq: () => mock, gt: () => mock, maybeSingle: async () => ({
              data: table === 'stage_rehearsal_invites'
                ? mode === 'not_invited' ? null : { expires_at: new Date(mode === 'expires_mid_cut' ? end - 1 : end).toISOString() }
                : { starts_at: windowState.AHNIKA_PREMIERE_START, presenter_name:'Ahnika Merlot', ticket_price_cents:0, status:'scheduled' },
            }) }
            return mock
          },
        }
      } },
      fetch: async u => {
        upstream++
        return u.pathname.startsWith('/functions/') ? Response.json({ url: storageUrl }) :
          new Response('abc', { status: 206, headers: { 'Content-Range': 'bytes 0-2/99' } })
      },
    }
    const route = load('app/api/stage/rehearsal-media/route.ts', opts)
    const result = await route.GET(new Request(url, { headers: { range: 'bytes=0-2' } }))
    assert.equal(result.status, mode === 'valid' ? 206 : 404, mode)
    assert.equal(upstream, mode === 'valid' ? 2 : 0, mode)
    if (mode === 'disabled') assert.equal(lookups, 0)
  }
})
