// Offline provider protocol tests. No secrets, production calls or posting.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const crypto = require('node:crypto')

function modules(extra = {}, imports = []) {
  const cache = {}
  function load(file) {
    if (cache[file]) return cache[file]
    const exports = {}; cache[file] = exports
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, Date, Intl, URL, Request, Response, TextDecoder,
      AbortController, setTimeout, clearTimeout, ...extra,
      require(name) {
        imports.push(name)
        if (name === 'node:crypto') return crypto
        if (name.startsWith('@/')) return load(name.replace('@/', '') + '.ts')
        throw Error('Unexpected import: ' + name)
      },
    }, { filename: file })
    return exports
  }
  return { api: load('lib/concierge/youtube-rehearsal-server.ts'), generation: load('lib/concierge/youtube-generation-server.ts') }
}

const libs = modules()
const TOKEN = 'test_only_' + '0'.repeat(32)
const NOW = Date.parse('2026-11-09T18:00:00Z')
const END = Date.parse('2026-11-11T06:30:00Z')
const completion = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })
const event = now => ({ sourcePath: '/events/hit-em-release-party', eventId: '00e7d9c6-61b9-4af9-827e-b6d13310b762',
  videoId: 'ZYA0r9JM6eA', title: 'Hit Em Release Party', startsAt: '2026-11-11T06:00:00.000Z',
  timeZone: 'America/Chicago', ticketPriceCents: 0, status: 'scheduled', observedAt: now, expiresAt: now + 60_000 })
const isReview = request => request.max_tokens === 256
function reviewPayload(request) {
  const raw = request.messages[0].content
  return JSON.parse(raw.slice(raw.indexOf('\n') + 1, raw.lastIndexOf('\n')))
}
function allow(request, patch = {}) {
  if (!isReview(request)) return completion('A welcoming room, a good groove, and a little space to discover something new together.')
  const { binding } = reviewPayload(request)
  return completion(JSON.stringify({ decision: 'allow', reason: 'safe', source_sha256: binding.sourceSha256,
    draft_sha256: binding.draftSha256, public_context_sha256: binding.publicContextSha256, ...patch }))
}
function request(body = { action: 'rehearsal' }, options = {}) {
  return new Request('https://www.cafe-sativa.com/api/concierge/youtube', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: typeof body === 'string' ? body : JSON.stringify(body), ...options })
}
function harness({ lib = libs, transport = request => allow(request), budget = { spent: false }, changes = {} } = {}) {
  let at = NOW
  const calls = [], reads = [], reservations = []
  const deps = { token: () => TOKEN, configured: () => true, clock: () => at,
    readPublicEvent: async signal => { reads.push(signal); return event(at) },
    reserveRehearsal: async signal => { reservations.push(signal); if (budget.spent) return false; budget.spent = true; return true },
    complete: async (request, options) => { calls.push({ request, options }); return transport(request, options) },
    ...changes,
  }
  const handle = lib.api.createYoutubeRehearsalHandler(deps)
  const endpoint = lib.generation.createYoutubeGenerationHandlers({ ...deps,
    quotaAvailable: () => { throw Error('Rehearsal must not check live quota') },
    reserve: () => { throw Error('Rehearsal must not consume live quota') }, rehearse: handle,
  })
  return { deps, calls, reads, reservations, budget, handle, endpoint,
    setTime: value => { at = value }, advance: ms => { at += ms },
    run: () => endpoint.POST(request()),
  }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('pre-event authenticated rehearsal uses real timestamps and two independent generation/review fixtures only', async () => {
  const h = harness(), response = await h.run(), result = await response.json()
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Object.keys(result), ['cases'])
  assert.deepEqual(result.cases, [
    { case: 'conversation', passed: true, generationMs: 0, reviewMs: 0, totalMs: 0 },
    { case: 'public-event', passed: true, generationMs: 0, reviewMs: 0, totalMs: 0 },
  ])
  assert.equal(h.reads.length, 1); assert.equal(h.reservations.length, 1); assert.equal(h.calls.length, 4)
  assert.equal(h.calls.filter(c => !isReview(c.request)).length, 2)
  for (const { request: model, options } of h.calls) {
    assert.equal(model.model, 'claude-haiku-4-5-20251001'); assert.equal(options.maxRetries, 0)
    assert.equal(model.max_tokens, isReview(model) ? 256 : 512)
    assert.equal(options.timeout, isReview(model) ? 5000 : 10000)
    if (isReview(model)) {
      const input = reviewPayload(model)
      assert.equal(input.source.publishedAt, NOW); assert.equal(input.source.observedAt, NOW)
      assert.equal(input.draft.createdAt, NOW); assert.equal(input.publicFacts.observedAt, NOW)
      assert.equal(input.source.eventId, 'private-rehearsal-only'); assert.equal(input.source.videoId, 'private-rehearsal-video')
      assert.equal(input.source.liveChatId, 'private_rehearsal_not_a_chat')
      assert.equal(input.publicFacts.eventId, input.source.eventId)
      assert.equal(input.publicFacts.videoId, input.source.videoId)
      assert.match(input.source.messageId, /^private-rehearsal-/)
      assert.equal(input.draft.postingEnabled, false)
      const facts = JSON.parse(input.publicFacts.publicProgramming)
      assert.equal(facts.events[0].startsAtUtc, '2026-11-11T06:00:00.000Z')
      assert.equal(facts.events[0].status, 'scheduled')
    } else {
      const input = JSON.parse(model.messages[0].content)
      assert.equal(input.privateRehearsal, true); assert.equal(input.currentGuest, 'synthetic-guest')
      assert.deepEqual(input.publicHistory, [])
      assert.doesNotMatch(model.system, /private canonical|private-rehearsal-only/)
      assert.ok(model.system.startsWith(libs.generation.YOUTUBE_GENERATION_SURFACE_RULES))
    }
  }
  assert.doesNotMatch(JSON.stringify(result), /A welcoming|sha256|draft|source|UC000|private-rehearsal-only|token|ZYA0/)
})

test('unauthenticated, missing config, unsupported URL, origin and cookie requests cannot read or spend', async () => {
  for (const options of [
    { headers: { 'Content-Type': 'application/json' } },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer incorrect' } },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Origin: 'https://www.cafe-sativa.com' } },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Cookie: 'session=x' } },
  ]) {
    const h = harness(), response = await h.endpoint.POST(request({ action: 'rehearsal' }, options))
    assert.ok([400, 401].includes(response.status)); assert.equal(h.calls.length, 0)
    assert.equal(h.reads.length, 0); assert.equal(h.reservations.length, 0)
  }
  const h = harness({ changes: { configured: () => false } })
  assert.equal((await h.run()).status, 503); assert.equal(h.reads.length, 0)
  for (const suffix of ['/other', '?debug=true']) {
    const h = harness(), req = request()
    const response = await h.handle(new Request(req.url + suffix, req), { action: 'rehearsal' })
    assert.equal(response.status, 400); assert.equal(h.reads.length, 0)
  }
})

test('only the exact action body is accepted; duplicates, extras, model/clock/source injection and malformed JSON cannot spend', async () => {
  for (const body of [null, [], {}, { action: 'other' }, { action: 'rehearsal', text: 'caller text' },
    { action: 'rehearsal', model: 'other' }, { action: 'rehearsal', now: NOW }, { action: 'rehearsal', source: {} },
    { action: 'rehearsal', fixtures: [] }, { action: 'rehearsal', __proto__: null, history: [] },
    '{"action":"other","action":"rehearsal"}', '{"action":"rehearsal","action":"rehearsal"}',
    '{"act\\u0069on":"rehearsal"}', '{"action":"rehearsal"', ' ', 'x'.repeat(20000)]) {
    const h = harness(), response = await h.endpoint.POST(request(body))
    assert.ok([400, 503].includes(response.status), JSON.stringify(body))
    assert.equal(h.calls.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.reservations.length, 0)
  }
  const h = harness()
  assert.equal((await h.endpoint.POST(request(' { "action" : "rehearsal" } '))).status, 200)
})

test('live API window stays closed before November 11 and after its original end', async () => {
  for (const at of [NOW, END]) {
    const h = harness(); h.setTime(at)
    assert.equal((await h.endpoint.GET(new Request('https://www.cafe-sativa.com/api/concierge/youtube'))).status, 200)
    assert.deepEqual(await (await h.endpoint.GET(new Request('https://www.cafe-sativa.com/api/concierge/youtube'))).json(), { available: false })
    assert.equal((await h.endpoint.POST(request({ source: {}, history: [] }))).status, 503)
    assert.equal(h.calls.length, 0); assert.equal(h.reads.length, 0)
  }
})

test('stale, canceled, live, paid, rescheduled, missing or mismatched public facts never reserve', async () => {
  for (const patch of [null, { status: 'live' }, { status: 'ended' }, { status: 'canceled' },
    { ticketPriceCents: 500 }, { eventId: 'other' }, { videoId: 'other' }, { title: 'other' },
    { sourcePath: '/private' }, { startsAt: '2026-11-12T06:00:00.000Z' }, { timeZone: 'UTC' },
    { observedAt: NOW + 1 }, { observedAt: NOW - 60000 }, { expiresAt: NOW },
    { expiresAt: NOW + 60001 }, { observedAt: NaN }]) {
    const h = harness({ changes: { readPublicEvent: async () => patch === null ? null : { ...event(NOW), ...patch } } })
    assert.equal((await h.run()).status, 503); assert.equal(h.reservations.length, 0); assert.equal(h.calls.length, 0)
  }
  const value = event(NOW)
  Object.defineProperty(value, 'privateRecords', { get() { throw Error('Must never read extra private fields') } })
  const h = harness({ changes: { readPublicEvent: async () => value } })
  assert.equal((await h.run()).status, 200)
})

test('one durable claim caps concurrent duplicate calls and survives new handler instances', async () => {
  const budget = { spent: false }, first = harness({ budget }), second = harness({ budget })
  const responses = await Promise.all([first.run(), second.run(), first.run()])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 429, 429])
  assert.equal(first.calls.length + second.calls.length, 4)
  const restarted = harness({ budget })
  assert.equal((await restarted.run()).status, 429); assert.equal(restarted.calls.length, 0)
})

test('provider denial/failure and malformed or truncated completions fail without retry, refill or text leakage', async () => {
  for (const transport of [
    () => { throw Error('secret key upstream error') }, () => completion(''),
    () => completion('x'.repeat(201)), () => ({ ...completion('short'), stop_reason: 'max_tokens' }),
    request => isReview(request) ? completion('malformed review') : allow(request),
    request => isReview(request) ? allow(request, { decision: 'deny', reason: 'unsupported_facts' }) : allow(request),
    request => isReview(request) ? allow(request, { source_sha256: '0'.repeat(64) }) : allow(request),
  ]) {
    const h = harness({ transport }), result = await (await h.run()).json()
    assert.equal(result.cases.length, 2); assert.equal(result.cases.every(c => !c.passed), true)
    assert.ok(h.calls.length === 2 || h.calls.length === 4)
    assert.doesNotMatch(JSON.stringify(result), /secret|upstream|malformed|sha256|welcoming/)
    const before = h.calls.length
    assert.equal((await h.run()).status, 429); assert.equal(h.calls.length, before)
  }
})

test('reserve false or error cannot call provider; uncertain committed claims cannot be retried after restart', async () => {
  for (const reserveRehearsal of [async () => false, async () => { throw Error('database secret') }]) {
    const h = harness({ changes: { reserveRehearsal } })
    assert.ok([429, 503].includes((await h.run()).status)); assert.equal(h.calls.length, 0)
  }
  const budget = { spent: false }
  const crashed = harness({ budget, changes: { reserveRehearsal: async () => { budget.spent = true; throw Error('lost commit response') } } })
  assert.equal((await crashed.run()).status, 503); assert.equal(crashed.calls.length, 0)
  const restarted = harness({ budget })
  assert.equal((await restarted.run()).status, 429); assert.equal(restarted.calls.length, 0)
})

test('aborts before dispatch do not spend; mid-provider abort cancels both calls, exposes no result, and cannot refund', async () => {
  const before = new AbortController(); before.abort()
  const first = harness()
  assert.ok([400, 503].includes((await first.endpoint.POST(request({ action: 'rehearsal' }, { signal: before.signal }))).status))
  assert.equal(first.reservations.length, 0); assert.equal(first.calls.length, 0)
  const pending = [], h = harness({ transport: model => new Promise(resolve => pending.push(() => resolve(allow(model)))) })
  const controller = new AbortController(), work = h.endpoint.POST(request({ action: 'rehearsal' }, { signal: controller.signal }))
  await tick(); assert.equal(h.calls.length, 2)
  controller.abort()
  const response = await work
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { cases: [] })
  assert.equal(h.calls.every(c => c.options.signal.aborted), true)
  pending.forEach(resolve => resolve()); await tick()
  assert.equal(h.calls.length, 2); assert.equal((await h.run()).status, 429)
})

test('real deadlines bound uncooperative generation and review calls; late resolutions cannot create pass results', async () => {
  for (const blockReview of [false, true]) {
    const timers = new Map(), pending = []
    let id = 0
    const lib = modules({ setTimeout: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key },
      clearTimeout: key => timers.delete(key) })
    const h = harness({ lib, transport: model => isReview(model) === blockReview
      ? new Promise(resolve => pending.push(() => resolve(allow(model)))) : allow(model) })
    const work = h.run(); await tick()
    const expectedTimeout = blockReview ? 5000 : 10000
    const active = [...timers.values()]
    assert.equal(active.length, 2); assert.equal(active.every(t => t.ms === expectedTimeout), true)
    active.forEach(t => t.fn())
    const result = await (await work).json()
    assert.equal(result.cases.every(c => !c.passed), true)
    pending.forEach(resolve => resolve()); await tick()
    assert.equal(result.cases.every(c => !c.passed), true); assert.equal(timers.size, 0)
    assert.equal((await h.run()).status, 429)
  }
})

test('expiry and bad clocks fail closed before and after reservation and completion, without future timestamps', async () => {
  for (const at of [END, END + 1, NaN, Infinity, NOW + 0.1, -1]) {
    const h = harness(); h.setTime(at)
    assert.equal((await h.run()).status, 503); assert.equal(h.reservations.length, 0); assert.equal(h.calls.length, 0)
  }
  for (const end of [END, NOW - 1, NOW + 60000]) {
    let h
    h = harness({ transport: model => { h.setTime(end); return allow(model) } })
    const response = await h.run()
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { cases: [] })
    assert.equal(h.calls.filter(c => isReview(c.request)).length, 0)
    h.setTime(NOW)
    assert.equal((await h.run()).status, 429)
  }
  let h
  h = harness({ changes: { reserveRehearsal: async () => { h.budget.spent = true; h.setTime(END); return true } } })
  assert.equal((await h.run()).status, 503); assert.equal(h.calls.length, 0)
})

test('import is dormant and cannot import provider SDK, credentials, private records, sender or database', () => {
  const imports = [], fail = () => { throw Error('Unexpected I/O') }
  modules({ Date: { parse: Date.parse, now: fail }, process: new Proxy({}, { get: fail }),
    fetch: fail, setTimeout: fail, WebSocket: fail }, imports)
  assert.doesNotMatch(imports.join('\n'), /anthropic|supabase|memory|livekit|personas|canonical|composio/)
  const source = fs.readFileSync('lib/concierge/youtube-rehearsal-server.ts', 'utf8')
  assert.doesNotMatch(source, /process\.env|\bfetch\(|readFile|console\.|\.send\(|\.insert\(/)
  assert.equal(typeof libs.api.send, 'undefined')
})
