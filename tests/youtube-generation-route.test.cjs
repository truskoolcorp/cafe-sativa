const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const token = 'synthetic_route_token_abcdefghijklmnopqrstuvwxyz'
const now = Date.parse('2026-11-11T06:02:00.000Z')
function harness(options = {}) {
  const cache = {}, fetches = [], modelCalls = [], clients = []
  const env = { LAVICHE_DYNAMIC_BRIDGE_TOKEN: token, ANTHROPIC_API_KEY: 'synthetic-provider',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
    NEXT_PUBLIC_SUPABASE_URL: 'https://nwfxvhqbjtfvoopcadff.supabase.co', ...options.env }
  class Clock extends Date { static now() { return options.now ?? now } }
  class Anthropic {
    constructor(config) { clients.push(config) }
    messages = { create: async (request, opts) => {
      modelCalls.push({ request, opts })
      if (options.providerFails) throw Error('DO_NOT_REFLECT_PROVIDER_OR_KEY')
      if (request.max_tokens === 512) return { stop_reason: 'end_turn', content: [{ type: 'text', text: options.generationText ?? 'Welcome in. What has been on your playlist lately?' }] }
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_synthetic', name: 'classify_public_reply', input: { decision: 'allow', reason: 'safe' } }] }
    } }
  }
  function load(file) {
    if (cache[file]) return cache[file]
    const exports = {}; cache[file] = exports
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
      exports, Date: Clock, Intl, URL, URLSearchParams, Request, Response, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout, process: { env },
      console: { error() { throw Error('No logging allowed') }, log() { throw Error('No logging allowed') } },
      fetch: async (input, init) => {
        const url = new URL(input); fetches.push({ url, init })
        if (options.fetch) return options.fetch(url, init)
        if (url.pathname === '/rest/v1/my_events_v') return Response.json([{ id: '00e7d9c6-61b9-4af9-827e-b6d13310b762', slug: 'hit-em-release-party',
          title: 'Hit Em Release Party', status: 'scheduled', starts_at: '2026-11-11T06:00:00+00:00', ticket_price_cents: 0, ...options.row }])
        if (url.pathname.startsWith('/rest/v1/rpc/')) return Response.json(options.reserve ?? true)
        throw Error('Unexpected destination')
      },
      require(name) {
        if (name === 'node:crypto') return require(name)
        if (name === '@anthropic-ai/sdk') return Anthropic
        if (name.startsWith('@/')) return load(name.replace('@/', '') + '.ts')
        throw Error('Unexpected dependency: ' + name)
      },
    }, { filename: file })
    return exports
  }
  const route = load('app/api/concierge/youtube/route.ts')
  const T = load('lib/concierge/youtube-draft-bridge.ts').YOUTUBE_DRAFT_TARGET
  const body = { source: { eventId: T.eventId, videoId: T.videoId, liveChatId: T.liveChatId, authenticatedChannelId: T.channelId,
    messageId: 'public-source', authorChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', text: 'Hi everyone!', publishedAt: now, observedAt: now }, history: [] }
  const req = (value = body, bearer = token) => new Request('https://www.cafe-sativa.com/api/concierge/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer ' + bearer }, body: typeof value === 'string' ? value : JSON.stringify(value) })
  return { route, req, fetches, modelCalls, clients }
}
test('route import has no network/model I/O; fully composed success isolates public and service credentials', async () => {
  const h = harness(); assert.equal(h.fetches.length, 0); assert.equal(h.clients.length, 0)
  const response = await h.route.POST(h.req()); assert.equal(response.status, 200)
  assert.equal(h.fetches.length, 2); assert.equal(h.modelCalls.length, 2)
  const [publicRead, reserve] = h.fetches
  assert.equal(publicRead.url.searchParams.get('select'), 'id,slug,title,status,starts_at,ticket_price_cents')
  assert.equal(publicRead.init.headers.apikey, 'synthetic-anon'); assert.equal(reserve.init.headers.apikey, 'synthetic-service')
  assert.equal(reserve.url.pathname, '/rest/v1/rpc/cs_reserve_youtube_generation')
  for (const { url, init } of h.fetches) { assert.equal(url.origin, 'https://nwfxvhqbjtfvoopcadff.supabase.co'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store') }
  for (const config of h.clients) assert.equal(config.maxRetries, 0)
  for (const { opts } of h.modelCalls) assert.equal(opts.maxRetries, 0)
  assert.doesNotMatch(await response.text(), /synthetic-|SUPABASE|ANTHROPIC|DO_NOT_REFLECT/)
})
test('missing token/key or nonpinned database origin performs no network I/O', async () => {
  for (const env of [{ LAVICHE_DYNAMIC_BRIDGE_TOKEN: undefined }, { ANTHROPIC_API_KEY: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://user:pass@nwfxvhqbjtfvoopcadff.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://nwfxvhqbjtfvoopcadff.supabase.co?x=1' }]) {
    const h = harness({ env }); assert.equal((await h.route.POST(h.req())).status, 503); assert.equal(h.fetches.length, 0)
  }
})
test('anonymous fresh event mismatch, redirect, oversize, HTTP failure never reserves quota', async () => {
  for (const options of [{ row: { status: 'ended' } }, { row: { ticket_price_cents: 100 } }, { row: { starts_at: '2026-11-12T06:00:00Z' } },
    { fetch: async () => Response.json({ private: 'NEVER_REFLECT' }, { status: 500 }) },
    { fetch: async () => new Response('x'.repeat(2049), { headers: { 'content-type': 'application/json' } }) },
    { fetch: async () => ({ ok: true, redirected: true }) }]) {
    const h = harness(options), response = await h.route.POST(h.req())
    assert.equal(response.status, 503); assert.equal(h.fetches.length, 1); assert.equal(h.modelCalls.length, 0)
    assert.doesNotMatch(await response.text(), /NEVER_REFLECT/)
  }
})
test('durable RPC false or provider exception return generic fail-closed response without retries', async () => {
  const denied = harness({ reserve: false }); assert.equal((await denied.route.POST(denied.req())).status, 429)
  assert.equal(denied.modelCalls.length, 0)
  const failed = harness({ providerFails: true }), response = await failed.route.POST(failed.req())
  assert.equal(response.status, 503); assert.equal(failed.modelCalls.length, 1); assert.equal(failed.fetches.length, 2)
  assert.doesNotMatch(await response.text(), /DO_NOT_REFLECT|synthetic-provider/)
})

test('separate authenticated pre-event rehearsal uses fixed fixtures and isolated one-time RPC, never emits live candidate', async () => {
  const h = harness({ now: Date.parse('2026-11-09T12:00:00Z') })
  const response = await h.route.POST(h.req({ action: 'rehearsal' })), result = await response.json()
  assert.equal(response.status, 200); assert.equal(result.cases.length, 2); assert.ok(result.cases.every(c => c.passed))
  assert.deepEqual(Object.keys(result), ['cases'])
  assert.equal(h.fetches.length, 2); assert.equal(h.fetches[1].url.pathname, '/rest/v1/rpc/cs_reserve_youtube_rehearsal')
  assert.equal(h.fetches[1].init.body, '{}'); assert.equal(h.modelCalls.length, 4)
  assert.doesNotMatch(JSON.stringify(result), /draft|text|messageId|source|proof|binding|Welcome in/)
  assert.equal((await h.route.POST(h.req())).status, 503) // live source/window was never opened
})
test('rehearsal route rejects duplicate action JSON before fixture spending', async () => {
  const h = harness({ now: Date.parse('2026-11-09T12:00:00Z') })
  const response = await h.route.POST(h.req('{"action":"different","action":"rehearsal"}'))
  assert.equal(response.status, 400); assert.equal(h.fetches.length, 0); assert.equal(h.modelCalls.length, 0)
})

test('v2 diagnostic rehearsal uses only its separate one-time RPC and exposes bounded metadata, not generated content', async () => {
  const h = harness({ now: Date.parse('2026-11-09T12:00:00Z') })
  const response = await h.route.POST(h.req({ action: 'rehearsal-v2' })), result = await response.json()
  assert.equal(response.status, 200); assert.equal(result.cases.length, 2); assert.ok(result.cases.every(c => c.passed))
  assert.equal(h.fetches[1].url.pathname, '/rest/v1/rpc/cs_reserve_youtube_rehearsal_v2')
  assert.equal(h.fetches[1].init.body, '{}'); assert.equal(h.fetches.length, 2); assert.equal(h.modelCalls.length, 4)
  assert.deepEqual(Object.keys(result), ['cases'])
  for (const item of result.cases) {
    assert.equal(item.diagnostics.generation.outcome, 'passed'); assert.equal(item.diagnostics.review.outcome, 'review_passed')
    assert.equal(item.diagnostics.generation.completion.stopReason, 'end_turn')
    assert.equal(item.diagnostics.review.policyCode, 'safe')
    assert.ok(item.diagnostics.generation.completion.textCharacters <= 200)
  }
  assert.doesNotMatch(JSON.stringify(result), /Welcome in|synthetic-provider|synthetic-service|messageId|sourceSha256|draftSha256|publicContextProof/)
  for (const { request } of h.modelCalls.filter(x => x.request.max_tokens === 512)) assert.match(request.system, /Aim for 100 characters or fewer in one short sentence, on one line\./)
})
test('v2 oversize diagnostic does not trim, rewrite or retry the rejected generation', async () => {
  const h = harness({ now: Date.parse('2026-11-09T12:00:00Z'), generationText: 'secret-rehearsal-output-' + 'x'.repeat(201) })
  const response = await h.route.POST(h.req({ action: 'rehearsal-v2' })), result = await response.json()
  assert.equal(response.status, 200); assert.equal(h.modelCalls.length, 2)
  for (const item of result.cases) {
    assert.equal(item.passed, false); assert.equal(item.diagnostics.generation.outcome, 'character_limit')
    assert.ok(item.diagnostics.generation.completion.textCharacters > 200); assert.equal(item.diagnostics.review.outcome, 'not_started')
  }
  assert.doesNotMatch(JSON.stringify(result), /secret-rehearsal-output|xxxxxxxx/)
})
test('denied or unavailable v2 RPC never falls back to original rehearsal or live budget', async () => {
  for (const mode of ['denied', 'unavailable']) {
    const h = harness({ now: Date.parse('2026-11-09T12:00:00Z'), fetch: async url => {
      if (url.pathname === '/rest/v1/my_events_v') return Response.json([{ id: '00e7d9c6-61b9-4af9-827e-b6d13310b762', slug: 'hit-em-release-party', title: 'Hit Em Release Party', status: 'scheduled', starts_at: '2026-11-11T06:00:00Z', ticket_price_cents: 0 }])
      return mode === 'denied' ? Response.json(false) : Response.json({ message: 'private-database-detail' }, { status: 404 })
    } })
    const response = await h.route.POST(h.req({ action: 'rehearsal-v2' }))
    assert.equal(response.status, mode === 'denied' ? 429 : 503); assert.equal(h.fetches.length, 2)
    assert.equal(h.fetches[1].url.pathname, '/rest/v1/rpc/cs_reserve_youtube_rehearsal_v2'); assert.equal(h.modelCalls.length, 0)
    assert.doesNotMatch(await response.text(), /private-database-detail/)
  }
})

test('v3 rehearsal uses only its independently capped RPC and forwards native classifier configuration unchanged', async () => {
  const h = harness({ now: Date.parse('2026-11-10T01:00:00Z') })
  const response = await h.route.POST(h.req({ action: 'rehearsal-v3' })), result = await response.json()
  assert.equal(response.status, 200); assert.equal(result.cases.length, 2); assert.ok(result.cases.every(c => c.passed))
  assert.equal(h.fetches[1].url.pathname, '/rest/v1/rpc/cs_reserve_youtube_rehearsal_v3')
  assert.equal(h.fetches[1].init.body, '{}'); assert.equal(h.fetches.length, 2); assert.equal(h.modelCalls.length, 4)
  for (const { request, opts } of h.modelCalls.filter(call => call.request.max_tokens === 256)) {
    assert.equal(request.tools.length, 1); assert.equal(request.tools[0].name, 'classify_public_reply')
    assert.equal(request.tool_choice.type, 'tool'); assert.equal(request.tool_choice.disable_parallel_tool_use, true)
    assert.equal(opts.maxRetries, 0)
  }
  for (const item of result.cases) {
    assert.equal(item.diagnostics.review.outcome, 'review_passed')
    assert.equal(item.diagnostics.review.completion.stopReason, 'tool_use')
  }
  assert.doesNotMatch(JSON.stringify(result), /Welcome in|toolu_synthetic|classify_public_reply|synthetic-provider|sourceSha256|draftSha256/)
})
test('v3 denied or missing RPC never falls back to earlier rehearsal or live budget', async () => {
  for (const mode of ['denied', 'missing']) {
    const h = harness({ now: Date.parse('2026-11-10T01:00:00Z'), fetch: async url => {
      if (url.pathname === '/rest/v1/my_events_v') return Response.json([{ id: '00e7d9c6-61b9-4af9-827e-b6d13310b762', slug: 'hit-em-release-party', title: 'Hit Em Release Party', status: 'scheduled', starts_at: '2026-11-11T06:00:00Z', ticket_price_cents: 0 }])
      return mode === 'denied' ? Response.json(false) : Response.json({ message: 'private-v3-detail' }, { status: 404 })
    } })
    const response = await h.route.POST(h.req({ action: 'rehearsal-v3' }))
    assert.equal(response.status, mode === 'denied' ? 429 : 503); assert.equal(h.fetches.length, 2)
    assert.equal(h.fetches[1].url.pathname, '/rest/v1/rpc/cs_reserve_youtube_rehearsal_v3'); assert.equal(h.modelCalls.length, 0)
    assert.doesNotMatch(await response.text(), /private-v3-detail/)
  }
})

const secondaryToken = 'synthetic_secondary_route_token_abcdefghijklmnopqrstuvwxyz'
test('actual route reads both named token slots and preserves primary-only and secondary-only authentication', async () => {
  for (const [primary, next, accepted] of [
    [token, undefined, [token]], [undefined, secondaryToken, [secondaryToken]],
    [token, secondaryToken, [token, secondaryToken]], [token, 'bad', [token]], ['bad', secondaryToken, [secondaryToken]],
  ]) {
    for (const bearer of accepted) {
      const h = harness({ env: { LAVICHE_DYNAMIC_BRIDGE_TOKEN: primary, LAVICHE_DYNAMIC_BRIDGE_TOKEN_NEXT: next } })
      const response = await h.route.POST(h.req(undefined, bearer))
      assert.equal(response.status, 200); assert.equal(h.modelCalls.length, 2); assert.equal(h.fetches.length, 2)
      const result = await response.text()
      assert.ok(!result.includes(token)); assert.ok(!result.includes(secondaryToken))
      assert.doesNotMatch(JSON.stringify(h.modelCalls), /synthetic_secondary_route_token|synthetic_route_token/)
    }
  }
})
test('actual route rejects unknown or absent tokens before all external work and expires both at the original end', async () => {
  for (const env of [{ LAVICHE_DYNAMIC_BRIDGE_TOKEN: undefined, LAVICHE_DYNAMIC_BRIDGE_TOKEN_NEXT: undefined },
    { LAVICHE_DYNAMIC_BRIDGE_TOKEN: 'invalid', LAVICHE_DYNAMIC_BRIDGE_TOKEN_NEXT: 'invalid' }]) {
    const h = harness({ env }); assert.equal((await h.route.POST(h.req())).status, 503)
    assert.equal(h.fetches.length, 0); assert.equal(h.modelCalls.length, 0)
  }
  const invalid = harness({ env: { LAVICHE_DYNAMIC_BRIDGE_TOKEN_NEXT: secondaryToken } })
  assert.equal((await invalid.route.POST(invalid.req(undefined, 'unknown_token_value_not_accepted_here'))).status, 401)
  assert.equal(invalid.fetches.length, 0); assert.equal(invalid.modelCalls.length, 0)
  for (const bearer of [token, secondaryToken]) {
    const h = harness({ now: Date.parse('2026-11-11T06:30:00Z'), env: { LAVICHE_DYNAMIC_BRIDGE_TOKEN_NEXT: secondaryToken } })
    assert.equal((await h.route.POST(h.req(undefined, bearer))).status, 503)
    assert.equal(h.fetches.length, 0); assert.equal(h.modelCalls.length, 0)
  }
})
test('secondary token passes rehearsal defensive authentication but cannot change fixture budgets or expiry', async () => {
  for (const action of ['rehearsal', 'rehearsal-v2', 'rehearsal-v3']) {
    const h = harness({ now: Date.parse('2026-11-10T02:00:00Z'), env: { LAVICHE_DYNAMIC_BRIDGE_TOKEN_NEXT: secondaryToken } })
    assert.equal((await h.route.POST(h.req({ action }, secondaryToken))).status, 200)
    assert.equal(h.fetches.length, 2); assert.equal(h.modelCalls.length, 4)
    const suffix = action === 'rehearsal' ? '' : action.slice('rehearsal'.length).replace('-', '_')
    assert.equal(h.fetches[1].url.pathname, '/rest/v1/rpc/cs_reserve_youtube_rehearsal' + suffix)
    const ended = harness({ now: Date.parse('2026-11-11T06:30:00Z'), env: { LAVICHE_DYNAMIC_BRIDGE_TOKEN_NEXT: secondaryToken } })
    assert.equal((await ended.route.POST(ended.req({ action }, secondaryToken))).status, 503)
    assert.equal(ended.fetches.length, 0); assert.equal(ended.modelCalls.length, 0)
  }
})
