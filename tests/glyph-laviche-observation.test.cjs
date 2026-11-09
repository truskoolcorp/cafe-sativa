const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createHarness, syntheticRow, envelope, jsonResponse, enrich, NOW, SOURCE, SYNTHETIC_ENV } = require('./helpers/targeted-canon-harness.cjs')

function reader(fetch, options = {}) {
  const harness = createHarness({ fetch, ...options })
  return { ...harness, read: harness.load('lib/content/glyph-laviche-observation.ts').liveLavicheCanonicalObservation }
}
const signal = () => new AbortController().signal
const unavailable = promise => assert.rejects(promise, error => error.message === 'unavailable')

test('fixed authenticated target, unchanged upstream timestamp and complete enriched private row', async () => {
  const raw = envelope(), calls = []
  const h = reader(async (...args) => { calls.push(args); return jsonResponse(raw) })
  const abort = signal(), result = await h.read(abort, '?observation=other')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], SOURCE + '?observation=laviche-fea')
  assert.deepEqual(calls[0][1], { headers: { Authorization: `Bearer ${SYNTHETIC_ENV.GLYPH_CANON_READ_TOKEN}` }, cache: 'no-store', redirect: 'error', signal: abort })
  assert.deepEqual(result, { ...raw, characters: [enrich(raw.characters[0])] })
  assert.equal(result.verifiedAt, raw.verifiedAt)
  const digest = h.load('lib/content/public-chat-attestation.ts').privateCanonicalDigest
  assert.equal(digest(result.characters[0]), digest(enrich(raw.characters[0])))
  assert.notEqual(digest(result.characters[0]), digest(raw.characters[0]))
  assert.ok(!JSON.stringify(result).includes(SYNTHETIC_ENV.GLYPH_CANON_READ_TOKEN))
})

test('portrait enrichment and complete row match the unchanged legacy registry reader', async () => {
  for (const patch of [{}, { portrait_available: false }, { primary_asset_id: null, sha256: null, rights_status: 'unavailable' }, { voice_id: null, voice_status: null, production_ready: false, blockers: ['canonical_voice_required'] }]) {
    const raw = envelope(syntheticRow(patch)), calls = []
    const h = reader(async url => { calls.push(url); return jsonResponse(raw) })
    const targeted = await h.read(signal())
    const legacy = await h.load('lib/content/glyph-live.ts').liveGlyphCharacters()
    assert.deepEqual(targeted, legacy)
    assert.deepEqual(calls, [SOURCE + '?observation=laviche-fea', SOURCE])
  }
})

test('wrong, duplicate, missing and mixed identities never filter into apparent success', async () => {
  for (const characters of [[], [syntheticRow({ id: 'chef-v' })], [syntheticRow({ id: '' })], [syntheticRow(), syntheticRow()], [syntheticRow(), syntheticRow({ id: 'chef-v' })], [null], [42], [[]], [{ id: 'laviche-fea' }]]) {
    await unavailable(reader(async () => jsonResponse(envelope(undefined, { characters }))).read(signal()))
  }
})

test('exact source envelope rejects errors, unknown fields and malformed source/time evidence', async () => {
  const cases = [null, [], {}, { error: 'canonical_source_unavailable' }]
  for (const patch of [{ live: false }, { live: 1 }, { source: 'snapshot' }, { studioUrl: 'https://other.invalid/' }, { characters: {} }, { verifiedAt: null }, { verifiedAt: 'invalid' }, { verifiedAt: '2026-11-09T09:00:00Z' }, { fetchedAt: NOW }, { error: 'canonical_source_unavailable' }]) cases.push(envelope(undefined, patch))
  for (const key of Object.keys(envelope())) { const raw = envelope(); delete raw[key]; cases.push(raw) }
  for (const raw of cases) await unavailable(reader(async () => jsonResponse(raw)).read(signal()))
})

test('full source row requires every known field and rejects unexpected shape', async () => {
  const cases = [syntheticRow({ extra: 'unexpected' }), syntheticRow({ portrait_url: 'https://other.invalid/' })]
  for (const key of Object.keys(syntheticRow())) { const row = syntheticRow(); delete row[key]; cases.push(row) }
  for (const patch of [{ name: null }, { primary_asset_id: 1 }, { sha256: [] }, { rights_status: null }, { voice_id: {} }, { voice_status: false }, { approved_reference_count: -1 }, { approved_reference_count: 1.2 }, { approved_reference_count: '1' }, { portrait_available: 1 }, { blockers: 'failure' }, { blockers: [null] }, { canonical_gaps: {} }, { canonical_gaps: [1] }, { requires_rights_consent: 'false' }, { canonical_context: null }, { profile_version: -1 }, { profile_version: 1.1 }, { production_ready: 'true' }]) cases.push(syntheticRow(patch))
  for (const row of cases) await unavailable(reader(async () => jsonResponse(envelope(row))).read(signal()))
})

test('authentication, network and HTTP failures are generic with no retry or registry fallback', async () => {
  let calls = 0
  await unavailable(reader(async () => { calls++; return jsonResponse(envelope()) }, { env: {} }).read(signal()))
  assert.equal(calls, 0)
  for (const reply of [() => { throw Error('SYNTHETIC_PRIVATE_SOURCE_ERROR') }, ...[401, 403, 404, 409, 500, 503].map(status => () => jsonResponse(envelope(), { status }))]) {
    calls = 0
    await unavailable(reader(async url => { calls++; assert.equal(url, SOURCE + '?observation=laviche-fea'); return reply() }).read(signal()))
    assert.equal(calls, 1)
  }
})

test('transport parser retains MIME, redirect, byte, duplicate-key and JSON protections', async () => {
  for (const response of [
    new Response(JSON.stringify(envelope())),
    new Response('<html>error</html>', { headers: { 'content-type': 'application/json' } }),
    new Response(' '.repeat(262145), { headers: { 'content-type': 'application/json' } }),
    new Response('{"live":false,"live":true}', { headers: { 'content-type': 'application/json' } }),
    jsonResponse(envelope(), { headers: { 'content-type': 'application/json', 'content-length': '262145' } }),
  ]) await unavailable(reader(async () => response).read(signal()))
  const redirected = jsonResponse(envelope())
  Object.defineProperty(redirected, 'redirected', { value: true })
  await unavailable(reader(async () => redirected).read(signal()))
})

test('same cancellation signal covers headers and body; already-aborted calls do not fetch', async () => {
  const before = new AbortController(); before.abort(); let calls = 0
  await unavailable(reader(async () => { calls++; return jsonResponse(envelope()) }).read(before.signal))
  assert.equal(calls, 0)
  const headers = new AbortController()
  const pendingHeaders = reader((_url, options) => new Promise((_resolve, reject) => {
    assert.equal(options.signal, headers.signal)
    options.signal.addEventListener('abort', () => reject(Error('SYNTHETIC_PRIVATE_ABORT')), { once: true })
  })).read(headers.signal)
  headers.abort(); await unavailable(pendingHeaders)
  let canceled = 0
  const body = new AbortController()
  const pendingBody = reader(async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}) }, cancel() { canceled++ },
  }), { headers: { 'content-type': 'application/json' } })).read(body.signal)
  await new Promise(resolve => setTimeout(resolve, 0)); body.abort()
  await unavailable(pendingBody); assert.equal(canceled, 1)
})

test('legacy portrait scope, authentication and integrity behavior stay unchanged', async () => {
  const bytes = Buffer.from('synthetic portrait'), calls = []
  const hash = createHash('sha256').update(bytes).digest('hex')
  const h = createHarness({ fetch: async (...args) => {
    calls.push(args)
    return new Response(bytes, { headers: { 'content-type': 'image/png', 'x-canonical-sha256': hash } })
  } })
  const legacy = h.load('lib/content/glyph-live.ts')
  assert.equal(await legacy.glyphPortrait('unknown', syntheticRow().primary_asset_id), null)
  assert.equal(calls.length, 0)
  assert.deepEqual(await legacy.glyphPortrait('laviche-fea', syntheticRow().primary_asset_id, hash), { bytes, mime: 'image/png' })
  assert.equal(calls[0][0], SOURCE + '?characterId=laviche-fea&assetId=' + syntheticRow().primary_asset_id)
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${SYNTHETIC_ENV.GLYPH_CANON_READ_TOKEN}`)
  await assert.rejects(legacy.glyphPortrait('laviche-fea', syntheticRow().primary_asset_id, 'c'.repeat(64)), /integrity/)
})

function factoryFixture({ patch = {}, row = syntheticRow(), clock = NOW } = {}) {
  const calls = [], raw = envelope(row, patch)
  let event
  const h = createHarness({ now: () => clock, fetch: async (url, options) => {
    calls.push([String(url), options])
    if (String(url) === SOURCE + '?observation=laviche-fea') return jsonResponse(raw)
    assert.equal(new URL(url).origin, 'https://nwfxvhqbjtfvoopcadff.supabase.co')
    assert.equal(new URL(url).pathname, '/rest/v1/my_events_v')
    return jsonResponse([{ id: event.eventId, slug: event.slug, title: event.title, description: '', status: 'scheduled', starts_at: event.startsAt, ticket_price_cents: 0 }])
  } })
  event = h.load('lib/events/hit-em-premiere.ts').HIT_EM_PREMIERE
  const api = h.load('lib/content/public-chat-attestation.ts')
  const approval = { version: 1, privateCanonicalSha256: api.privateCanonicalDigest(enrich(row)), publicReplyArtifactSha256: 'a'.repeat(64), validFrom: clock - 1000, validUntil: clock + 120000 }
  const serve = h.load('lib/content/public-chat-readiness-server.ts').createFixedServerReadiness(approval)
  return { ...h, calls, raw, approval, serve }
}

test('dormant factory targets only Laviche, binds enriched row and exposes only public projection', async () => {
  const f = factoryFixture()
  assert.equal(f.calls.length, 0)
  const result = await f.serve()
  assert.equal(result.status, 200)
  assert.equal(f.calls.length, 2)
  const canonical = f.calls.find(([url]) => url.startsWith(SOURCE))
  assert.equal(canonical[0], SOURCE + '?observation=laviche-fea')
  assert.equal(f.calls[0][1].signal, f.calls[1][1].signal)
  for (const privateValue of ['SYNTHETIC_PRIVATE', 'portrait_url', f.approval.privateCanonicalSha256, SOURCE, SYNTHETIC_ENV.GLYPH_CANON_READ_TOKEN]) assert.ok(!JSON.stringify(result).includes(privateValue))
  assert.equal(result.body.observation.startedAt, new Date(NOW).toISOString())
  assert.equal(result.body.observation.expiresAt, new Date(NOW + 60000).toISOString())
})

test('stale/future producer timestamps cannot be restamped into readiness', async () => {
  for (const verifiedAt of [new Date(NOW - 1).toISOString(), new Date(NOW + 1).toISOString()]) {
    const f = factoryFixture({ patch: { verifiedAt } })
    assert.equal((await f.serve()).status, 503)
    assert.equal(f.calls.length, 2)
    assert.equal(f.raw.verifiedAt, verifiedAt)
  }
})

test('complete enriched row changes remain privately pinned; source readiness failures stay closed', async () => {
  for (const patch of [{ name: 'Changed' }, { profile_version: 8 }, { sha256: 'c'.repeat(64) }, { canonical_gaps: ['changed'] }, { production_ready: false }, { voice_id: null }, { rights_status: 'unavailable' }]) {
    const f = factoryFixture()
    Object.assign(f.raw.characters[0], patch)
    assert.equal((await f.serve()).status, 503)
  }
})

test('unconfigured runtime remains 503 with one private configuration read and no credentials or network', async () => {
  let calls = 0, envReads = 0
  const h = createHarness({ env: new Proxy({}, { get(_target, key) { envReads++; assert.equal(key, 'CAFE_PRIVATE_CHAT_READINESS_JSON', 'Credential and other environment reads forbidden'); return undefined } }), fetch: async () => { calls++; throw Error('No network allowed') } })
  const runtime = h.load('lib/content/public-chat-attestation-runtime.ts')
  for (let i = 0; i < 3; i++) assert.deepEqual(await runtime.publicChatReadiness(), { status: 503, body: { error: 'Readiness unavailable' } })
  assert.equal(envReads, 1); assert.equal(calls, 0)
})

