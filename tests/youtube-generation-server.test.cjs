const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function modules(extra = {}) {
  const cache = {}
  function load(file) {
    if (cache[file]) return cache[file]
    const exports = {}; cache[file] = exports
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Date, Intl, URL, Request, Response, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout,
      require(name) {
        if (name === 'node:crypto') return require(name)
        if (name.startsWith('@/')) return load(name.replace('@/', '') + '.ts')
        throw Error('Unexpected dependency: ' + name)
      }, ...extra,
    }, { filename: file })
    return exports
  }
  return { api: load('lib/concierge/youtube-generation-server.ts'), target: load('lib/concierge/youtube-draft-bridge.ts').YOUTUBE_DRAFT_TARGET }
}
const { api, target: T } = modules()
const TOKEN = 'synthetic_test_token_never_a_real_credential_12345'
const A = 'UCaaaaaaaaaaaaaaaaaaaaaa', B = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const clone = value => JSON.parse(JSON.stringify(value))
function reviewCompletion(request, patch = {}) {
  const binding = JSON.parse(request.messages[0].content.split('\n')[1]).binding
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ decision: 'allow', reason: 'safe',
    source_sha256: binding.sourceSha256, draft_sha256: binding.draftSha256, public_context_sha256: binding.publicContextSha256, ...patch }) }] }
}
function harness(options = {}, lib = api) {
  let now = T.startsAt + 120000, reads = 0, reservations = 0, checks = 0
  const calls = []
  const event = () => ({ sourcePath: '/events/hit-em-release-party', eventId: T.eventId, videoId: T.videoId,
    title: 'Hit Em Release Party', startsAt: '2026-11-11T06:00:00.000Z', timeZone: 'America/Chicago', ticketPriceCents: 0,
    status: 'scheduled', observedAt: now, expiresAt: now + 60000, ...options.event })
  const deps = {
    token: () => TOKEN, configured: () => true, clock: () => now,
    readPublicEvent: async signal => { reads++; return options.read ? options.read(signal, event()) : event() },
    quotaAvailable: async () => { checks++; return options.available ?? true },
    reserve: async (source, signal) => { reservations++; return options.reserve ? options.reserve(source, signal) : true },
    complete: async (request, opts) => {
      calls.push({ request, opts })
      if (options.complete) return options.complete(request, opts, calls.length)
      return calls.length % 2 === 1
        ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'That bassline has a real strut to it. What music are you into?' }] }
        : reviewCompletion(request)
    },
    ...options.deps,
  }
  const handlers = lib.createYoutubeGenerationHandlers(deps)
  const body = (patch = {}) => ({ source: { eventId: T.eventId, videoId: T.videoId, liveChatId: T.liveChatId,
    authenticatedChannelId: T.channelId, authorChannelId: A, messageId: 'source-' + now, publishedAt: now, observedAt: now,
    text: 'Jazz is my thing. What music do you like?', ...patch }, history: [] })
  const request = (value = body(), headers = {}, url = 'https://www.cafe-sativa.com/api/concierge/youtube', extra = {}) =>
    new Request(url, { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', ...headers },
      body: typeof value === 'string' ? value : JSON.stringify(value), ...extra })
  return { handlers, calls, body, request, counts: () => ({ reads, reservations, checks }), advance: ms => { now += ms }, now: () => now }
}

test('disabled and unauthorized requests never read body or call dependencies', async () => {
  for (const deps of [{ token: () => undefined }, { token: () => 'short' }, { configured: () => false }]) {
    const h = harness({ deps }); const response = await h.handlers.POST(h.request())
    assert.equal(response.status, 503); assert.deepEqual(h.counts(), { reads: 0, reservations: 0, checks: 0 }); assert.equal(h.calls.length, 0)
  }
  for (const authorization of ['', 'Bearer wrong', 'bearer ' + TOKEN, 'Bearer ' + 'x'.repeat(40)]) {
    const h = harness(); assert.equal((await h.handlers.POST(h.request('{', { authorization }))).status, 401)
    assert.equal(h.counts().reads, 0); assert.equal(h.counts().reservations, 0)
  }
})
test('bearer comparison uses only bounded exact-format headers', () => {
  assert.equal(api.youtubeBearerMatches('Bearer ' + TOKEN, TOKEN), true)
  for (const header of [null, TOKEN, 'Bearer '+TOKEN+', Bearer '+TOKEN, 'Bearer '+'a'.repeat(300)]) assert.equal(api.youtubeBearerMatches(header, TOKEN), false)
})
test('no name mention is needed: one durable reservation precedes exactly two bounded model calls', async () => {
  const h = harness(), response = await h.handlers.POST(h.request()), result = await response.json()
  assert.equal(response.status, 200); assert.equal(result.status, 'reviewed-draft'); assert.equal(result.postingEnabled, false)
  assert.equal(result.draft.status, 'draft-needs-review'); assert.equal(result.draft.postingEnabled, false)
  assert.equal(result.review.decision, 'allow'); assert.equal(result.review.postingEnabled, false)
  assert.equal(h.counts().reservations, 1); assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].request.max_tokens, 512); assert.equal(h.calls[1].request.max_tokens, 256)
  assert.deepEqual(h.calls.map(x => x.opts.maxRetries), [0, 0]); assert.deepEqual(h.calls.map(x => x.opts.timeout), [10000, 5000])
  assert.match(h.calls[0].request.system, /Do not volunteer AI\/bot disclaimers/)
  assert.match(h.calls[0].request.system, /truthfully say you are the virtual AI host/)
  assert.match(h.calls[0].request.system, /Concrete Rose/)
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.doesNotMatch(JSON.stringify(result), /synthetic_test_token|apiKey|stack|system/)
})
test('bounded public-room conversation is labeled separately from current guest and confirmed host reply target', async () => {
  const h = harness(), value = h.body()
  value.history = [
    { messageId: 'public-a', authorChannelId: A, text: 'I like jazz.', publishedAt: h.now() - 10000 },
    { messageId: 'public-b', authorChannelId: B, text: 'I like disco.', publishedAt: h.now() - 9000 },
    { messageId: 'public-host', authorChannelId: T.channelId, sourceMessageId: 'public-b', text: 'Disco brings a room together.', publishedAt: h.now() - 8000 },
  ]
  assert.equal((await h.handlers.POST(h.request(value))).status, 200)
  const message = h.calls[0].request.messages[0].content, data = JSON.parse(message)
  assert.equal(data.currentGuest, data.publicHistory[0].speaker)
  assert.notEqual(data.currentGuest, data.publicHistory[1].speaker)
  assert.equal(data.publicHistory[2].replyingTo, data.publicHistory[1].speaker)
  assert.doesNotMatch(message, /UCaaaaaaaa|UCbbbbbbbb|public-a|public-b|public-host/)
})
test('malformed shape, private context, wrong target, stale/future/oversize/control input are rejected before reads', async () => {
  const patches = [{ eventId: 'wrong' }, { videoId: 'wrong' }, { liveChatId: 'wrong' }, { authenticatedChannelId: A },
    { authorChannelId: T.channelId }, { authorChannelId: 'bad' }, { messageId: '' }, { text: 'x'.repeat(501) }, { text: '\u202ehello' },
    { publishedAt: T.startsAt - 1 }, { observedAt: T.endsAt }, { publishedAt: T.endsAt }, { privateHistory: 'private' }]
  for (const patch of patches) {
    const h = harness(); assert.equal((await h.handlers.POST(h.request(h.body(patch)))).status, 400)
    assert.equal(h.counts().reads, 0); assert.equal(h.calls.length, 0)
  }
  const h = harness(), stale = h.body(); h.advance(30000)
  assert.equal((await h.handlers.POST(h.request(stale))).status, 400)
  for (const value of [null, {}, { ...h.body(), context: 'private' }, { ...h.body(), history: new Array(7).fill({}) }, { ...h.body(), host: 'laviche' }])
    assert.equal((await h.handlers.POST(h.request(value))).status, 400)
})
test('history refuses draft/unbound/duplicate assistant replies and invalid room provenance shapes', async () => {
  const h = harness(), base = { messageId: 'prior', authorChannelId: A, text: 'hello', publishedAt: h.now() - 1000 }
  for (const history of [
    [{ ...base, authorChannelId: T.channelId }], [{ ...base, authorChannelId: T.channelId, sourceMessageId: 'missing' }],
    [base, { ...base }], [{ ...base, private: 'ASK' }], [{ ...base, authorChannelId: 'not-a-channel' }],
    [{ ...base, publishedAt: T.startsAt - 1 }], [{ ...base, publishedAt: h.now() + 1 }],
    [base, { ...base, messageId: 'host', authorChannelId: T.channelId, sourceMessageId: 'prior', text: 'x'.repeat(201) }],
  ]) assert.equal((await h.handlers.POST(h.request({ ...h.body(), history }))).status, 400)
  assert.equal(h.counts().reads, 0)
})
test('query, browser cookie/origin, malformed JSON and oversized byte streams cannot spend', async () => {
  for (const headers of [{ cookie: 'session=private' }, { origin: 'https://www.cafe-sativa.com' }, { 'content-type': 'text/plain' }, { 'content-length': '99999' }]) {
    const h = harness(); assert.equal((await h.handlers.POST(h.request(h.body(), headers))).status, 400); assert.equal(h.counts().reservations, 0)
  }
  for (const value of ['{', ' '.repeat(16385), '\u0000']) {
    const h = harness(); assert.equal((await h.handlers.POST(h.request(value))).status, 400); assert.equal(h.calls.length, 0)
  }
  const h = harness(); assert.equal((await h.handlers.POST(h.request(h.body(), {}, 'https://www.cafe-sativa.com/api/concierge/youtube?token=secret'))).status, 400)
})
test('expired or not-yet-active token is denied without database or model calls', async () => {
  for (const at of [T.startsAt - 1, T.endsAt, T.endsAt + 1]) {
    const h = harness(); h.advance(at - h.now())
    assert.equal((await h.handlers.POST(h.request())).status, 503)
    assert.equal(h.counts().reads, 0); assert.equal(h.counts().reservations, 0)
  }
})
test('public event reads fail closed; no client fact can replace current source', async () => {
  for (const event of [{ status: 'canceled' }, { ticketPriceCents: 100 }, { eventId: 'wrong' }, { expiresAt: T.startsAt }, { title: 'Wrong' }]) {
    const h = harness({ event }); assert.equal((await h.handlers.POST(h.request())).status, 503)
    assert.equal(h.counts().reservations, 0); assert.equal(h.calls.length, 0)
  }
})
test('quota refusal or uncertainty never invokes provider or retries reservation', async () => {
  for (const reserve of [async () => false, async () => { throw Error('private-database-error') }]) {
    const h = harness({ reserve }), response = await h.handlers.POST(h.request())
    assert.ok([429, 503].includes(response.status)); assert.equal(h.calls.length, 0); assert.equal(h.counts().reservations, 1)
    assert.doesNotMatch(await response.text(), /private-database/)
  }
})
test('generation failures burn reservation and expose no errors; invalid outputs never reach review', async () => {
  for (const completion of [null, { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] },
    { stop_reason: 'end_turn', content: [] }, ...['x'.repeat(201), 'bad\nline', 'https://wrong.invalid', 'me@example.test'].map(text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }))]) {
    const h = harness({ complete: async () => completion }), response = await h.handlers.POST(h.request())
    assert.equal(response.status, 503); assert.equal(h.calls.length, 1); assert.equal(h.counts().reservations, 1)
  }
  const h = harness({ complete: async () => { throw Error('provider-secret-detail') } })
  const response = await h.handlers.POST(h.request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /provider-secret/)
})
test('review deny, hash mismatch, malformed completion cannot emit candidate and never retry', async () => {
  for (const patch of [{ decision: 'deny', reason: 'unsupported_facts' }, { source_sha256: 'wrong' }, { extra: 'safe' }]) {
    const h = harness({ complete: async (request, opts, count) => count === 1
      ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Welcome to the room.' }] } : reviewCompletion(request, patch) })
    const response = await h.handlers.POST(h.request())
    assert.equal(response.status, 503); assert.equal(h.calls.length, 2); assert.doesNotMatch(await response.text(), /Welcome to the room/)
  }
})
test('expiration or clock rollback during provider call discards draft and avoids review', async () => {
  for (const delta of [30000, -1]) {
    const h = harness({ complete: async () => { h.advance(delta); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Late reply' }] } } })
    assert.equal((await h.handlers.POST(h.request())).status, 503); assert.equal(h.calls.length, 1)
  }
})
test('aborted request cannot spend and late provider after timeout cannot produce candidate', async () => {
  const controller = new AbortController(); controller.abort()
  const h = harness(); assert.equal((await h.handlers.POST(h.request(h.body(), {}, undefined, { signal: controller.signal }))).status, 503)
  assert.equal(h.calls.length, 0)
  let late
  const lib = modules({ setTimeout: (fn, ms) => setTimeout(fn, ms === 10000 ? 5 : ms) }).api
  const stalled = harness({ complete: () => new Promise(resolve => { late = resolve }) }, lib)
  assert.equal((await stalled.handlers.POST(stalled.request())).status, 503)
  assert.equal(stalled.calls.length, 1); assert.equal(stalled.calls[0].opts.signal.aborted, true)
  late({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Late reply' }] })
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(stalled.calls.length, 1)
})
test('readiness is boolean-only, read-only, event-window bounded and fails closed', async () => {
  for (const options of [{}, { available: false }, { event: { status: 'ended' } }, { deps: { token: () => undefined } }]) {
    const h = harness(options), response = await h.handlers.GET(new Request('https://www.cafe-sativa.com/api/concierge/youtube'))
    assert.deepEqual(await response.json(), { available: Object.keys(options).length === 0 })
    assert.equal(h.counts().reservations, 0); assert.equal(h.calls.length, 0)
  }
})
test('a shared durable reservation authority caps model spending across handler instances', async () => {
  let consumed = 0
  const used = new Set()
  const reserve = async source => {
    if (used.has(source.messageId) || consumed >= 30) return false
    used.add(source.messageId); consumed++; return true
  }
  const handlers = Array.from({ length: 35 }, (_, index) => { const h = harness({ reserve }); return { h, body: h.body({ messageId: 'unique-' + index }) } })
  const results = await Promise.all(handlers.map(({ h, body }) => h.handlers.POST(h.request(body))))
  assert.equal(results.filter(x => x.status === 200).length, 30); assert.equal(consumed, 30)
  assert.equal(handlers.reduce((sum, { h }) => sum + h.calls.length, 0), 60)
  const retry = harness({ reserve }); assert.equal((await retry.handlers.POST(retry.request(retry.body({ messageId: 'unique-0' })))).status, 429)
  assert.equal(retry.calls.length, 0)
})
test('local migration restricts ACLs, pins event and serializes reservation before permanent increment', () => {
  const sql = fs.readFileSync('supabase/migrations/20261109180000_youtube_generation_quota.sql', 'utf8')
  assert.match(sql, /attempts BETWEEN 0 AND 30/)
  assert.match(sql, /FOR UPDATE/); assert.ok(sql.indexOf('FOR UPDATE') < sql.indexOf('at_time := clock_timestamp()'))
  assert.match(sql, /PRIMARY KEY \(event_id, source_message_id\)/)
  assert.match(sql, /SECURITY DEFINER SET search_path = ''/)
  assert.match(sql, /REVOKE ALL ON public.cs_youtube_generation_budget FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(sql, /REVOKE ALL ON public.cs_youtube_generation_reservations FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public.cs_reserve_youtube_generation\(uuid, text, text, text\) TO service_role/)
  assert.match(sql, /2026-11-11T06:00:00Z/); assert.match(sql, /2026-11-11T06:30:00Z/)
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT .* TO (?:anon|authenticated)|DELETE FROM|source_text|message_text/i)
})

test('stale room context fails at parse and again after durable reservation before model', async () => {
  const h = harness(), value = h.body()
  value.history = [{ messageId: 'old', authorChannelId: B, text: 'old public topic', publishedAt: h.now() - 60000 }]
  assert.equal((await h.handlers.POST(h.request(value))).status, 400); assert.equal(h.counts().reads, 0)
  const delayed = harness({ reserve: async () => { delayed.advance(1000); return true } }), pending = delayed.body()
  pending.history = [{ ...value.history[0], publishedAt: delayed.now() - 59000 }]
  assert.equal((await delayed.handlers.POST(delayed.request(pending))).status, 503)
  assert.equal(delayed.counts().reservations, 1); assert.equal(delayed.calls.length, 0)
})
test('rehearsal dispatch is separately injected, authenticated and accepts only exact unambiguous fixture action', async () => {
  let rehearsals = 0
  const h = harness({ deps: { rehearse: async () => { rehearsals++; return new Response(JSON.stringify({ cases: [] }), { status: 200 }) } } })
  h.advance(T.startsAt - 1000 - h.now())
  assert.equal((await h.handlers.POST(h.request({ action: 'rehearsal' }))).status, 200)
  assert.equal(rehearsals, 1); assert.equal(h.counts().reads, 0); assert.equal(h.calls.length, 0)
  for (const value of [{ action: 'rehearsal', source: 'extra' }, { action: 'different' },
    '{"action":"different","action":"rehearsal"}', '{"\\u0061ction":"rehearsal"}'])
    assert.equal((await h.handlers.POST(h.request(value))).status, 400)
  assert.equal(rehearsals, 1)
  assert.equal((await h.handlers.POST(h.request({ action: 'rehearsal' }, { authorization: 'wrong' }))).status, 401)
  const unwired = harness(); assert.equal((await unwired.handlers.POST(unwired.request({ action: 'rehearsal' }))).status, 400)
})
test('public context proof binds exact reviewed static projection and freshness without prose', async () => {
  const h = harness(), result = await (await h.handlers.POST(h.request())).json()
  assert.equal(result.publicContextProof.version, 'youtube-approved-public-context-v1')
  assert.equal(result.publicContextProof.observedAt, h.now()); assert.equal(result.publicContextProof.eventStatus, 'scheduled')
  assert.match(result.publicContextProof.projectionSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(result.publicContextProof), ['version', 'observedAt', 'expiresAt', 'eventStatus', 'projectionSha256'])
})
