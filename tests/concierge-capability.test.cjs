const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { NextResponse } = require('next/server')

const ID = '12345678-1234-1234-1234-123456789abc'
const OTHER = '87654321-4321-4321-4321-cba987654321'
const ORIGIN = 'https://mall.truskool.net'
const URL_BASE = 'https://www.cafe-sativa.com/api/concierge'
const SESSION = 'mall-1794147756000-abc12345'
const legacy = { host: 'laviche', message: 'Hello', session_id: SESSION, surface: 'mall-3d' }
const fenced = { 'X-Concierge-Durable': '0', 'X-Concierge-Requester': `guest:${SESSION}` }

function harness({ env = {}, userId = null, authError = null } = {}) {
  const calls = { authFactory: 0, auth: 0, admin: 0, database: 0, rate: 0, memory: 0, canonical: 0, content: 0, events: 0, provider: 0, writes: 0, body: 0 }
  const cache = new Map()
  const admin = { from(table) {
    calls.database++
    let inserting = false
    const query = {
      select() { return this }, eq() { return this }, gte() { return this }, is() { return this },
      order() { return this }, limit() { return this }, in() { return this },
      insert() { inserting = true; calls.writes++; return this },
      single() { return this }, maybeSingle() { return this },
      then(resolve) {
        const data = table === 'memberships' ? null : table === 'host_conversations'
          ? { id: ID, user_id: userId, session_id: SESSION, host_agent: 'laviche', ended_at: null }
          : inserting ? null : []
        return Promise.resolve(resolve({ data, error: null }))
      },
    }
    return query
  } }
  // Only external I/O boundaries are mocked. Policy, validation, CORS, origin,
  // persona, history and ownership code run from the actual production files.
  const mocks = {
    'next/server': { NextResponse },
    '@anthropic-ai/sdk': { default: class {
      messages = { create: async () => { calls.provider++; return { content: [{ type: 'text', text: 'Synthetic general reply' }] } } }
    } },
    '@/lib/content/concierge-canon': { canonicalConciergeHost: async () => { calls.canonical++; return { context: 'Approved synthetic context' } } },
    '@/lib/content/site': { getSiteContent: async () => { calls.content++; return [] } },
    '@/lib/events': { getUpcomingEvents: async () => { calls.events++; return [] } },
    '@/lib/supabase/server': { createClient: () => { calls.authFactory++; return { auth: { getUser: async () => {
      calls.auth++; return { data: { user: userId ? { id: userId } : null }, error: authError }
    } } } } },
    '@/lib/supabase/admin': { createAdminClient: () => { calls.admin++; return admin } },
    '@/lib/concierge/rate-limit': { checkRateLimit: async () => { calls.rate++; return { allowed: true, remaining: 10 } } },
    '@/lib/concierge/memory': { getMemoryContext: async () => { calls.memory++; return [] } },
  }
  function load(file) {
    file = path.normalize(file)
    if (cache.has(file)) return cache.get(file)
    const exports = {}
    cache.set(file, exports)
    const context = { exports, Date, Intl, URL, Set, Request, Response, Headers,
      process: { env: { ANTHROPIC_API_KEY: 'synthetic-test-only', ...env } },
      console: { error() {} }, fetch() { throw Error('Real network is forbidden in this test') },
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
        if (name.startsWith('.')) return load(path.join(path.dirname(file), name) + '.ts')
        throw Error(`Unexpected dependency: ${name}`)
      },
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context, { filename: file })
    return exports
  }
  const main = load('app/api/concierge/route.ts'), status = load('app/api/concierge/status/route.ts')
  async function request({ method = 'GET', endpoint = 'status', body = legacy, headers = {}, origin = ORIGIN, url } = {}) {
    const request = new Request(url ?? `${URL_BASE}${endpoint === 'status' ? '/status' : ''}`, {
      method, headers: { ...(origin !== null ? { Origin: origin } : {}), ...headers },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    })
    const parse = request.json.bind(request)
    request.json = async () => { calls.body++; return parse() }
    return (endpoint === 'status' ? status : main)[method](request)
  }
  return { calls, request, status }
}
function noIO(calls, body = 0) {
  assert.deepEqual(calls, { authFactory: 0, auth: 0, admin: 0, database: 0, rate: 0, memory: 0, canonical: 0, content: 0, events: 0, provider: 0, writes: 0, body })
}
function noReplay(data) {
  for (const key of ['recovery_required', 'terminal', 'admitted', 'message', 'request_id', 'session_id', 'conversation_id', 'durable']) assert.equal(Object.hasOwn(data, key), false, key)
}

test('capability is explicit, dynamic, no-store and hard-disabled in every supported OFF configuration', async () => {
  for (const value of [undefined, '', 'off']) {
    const h = harness({ env: { CONCIERGE_DURABLE_MODE: value } })
    const res = await h.request()
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { durable_enabled: false, durable_payload_version: 2, text_admissions_enabled: true })
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
    assert.equal(res.headers.get('vary'), 'Origin')
    assert.equal(res.headers.get('access-control-allow-credentials'), null)
    assert.equal(h.status.dynamic, 'force-dynamic')
    assert.equal(h.status.revalidate, 0)
    noIO(h.calls)
  }
})
test('no environment value including on can advertise durable support or run legacy I/O', async () => {
  for (const value of ['on', 'ON', 'false', 'true', ' off', 'off ', '0', 'invalid']) {
    const h = harness({ env: { CONCIERGE_DURABLE_MODE: value } })
    for (const args of [{}, { endpoint: 'main', method: 'POST' }]) {
      const res = await h.request(args), data = await res.json()
      assert.equal(res.status, 503)
      assert.equal(data.code, 'policy_unavailable')
      assert.equal(data.durable_enabled, undefined)
      assert.equal(res.headers.get('cache-control'), 'no-store')
      noReplay(data)
    }
    noIO(h.calls)
  }
})
test('maintenance only pauses text, is reflected in capability and rejects before auth/body/I/O', async () => {
  for (const value of ['on', 'ON', 'true', ' off', '0']) {
    const h = harness({ env: { CONCIERGE_TEXT_MAINTENANCE: value } })
    const res = await h.request(), data = await res.json()
    assert.equal(res.status, value === 'on' ? 200 : 503)
    assert.equal(data.text_admissions_enabled, value === 'on' ? false : undefined)
    const post = await h.request({ endpoint: 'main', method: 'POST' })
    assert.equal(post.status, 503)
    assert.equal((await post.json()).code, value === 'on' ? 'text_maintenance' : 'policy_unavailable')
    noIO(h.calls)
  }
})
test('capability reevaluates config instead of retaining a module-time answer', async () => {
  const src = fs.readFileSync('lib/concierge/capability.ts', 'utf8'), env = {}, exports = {}
  vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, process: { env } })
  assert.equal(exports.conciergeCapability().text_admissions_enabled, true)
  env.CONCIERGE_TEXT_MAINTENANCE = 'on'
  assert.equal(exports.conciergeCapability().text_admissions_enabled, false)
  env.CONCIERGE_DURABLE_MODE = 'on'
  assert.equal(exports.conciergeCapability().invalid, true)
  assert.equal(exports.conciergeCapability().durable_enabled, false)
})
test('durable and malformed mode headers reject before parsing/auth/database/provider', async () => {
  for (const header of ['1', '', 'true', '01', '0, 1', '0, 0', '2']) {
    const h = harness(), res = await h.request({ method: 'POST', endpoint: 'main', headers: { 'X-Concierge-Durable': header }, body: null })
    assert.equal(res.status, header === '1' ? 409 : 400)
    assert.equal((await res.json()).code, header === '1' ? 'mode_changed' : 'invalid_durable_mode')
    noIO(h.calls)
  }
})
test('durable body identities never silently downgrade with missing or legacy headers', async () => {
  for (const headers of [{}, fenced]) for (const identity of [{ request_id: ID }, { issued_at: 1 }, { request_id: null }]) {
    const h = harness(), res = await h.request({ method: 'POST', endpoint: 'main', headers, body: { ...legacy, ...identity } })
    assert.equal(res.status, 409)
    const data = await res.json()
    assert.equal(data.code, 'mode_changed'); noReplay(data); noIO(h.calls, 1)
  }
})
test('missing/malformed requester fences reject before auth/database/provider', async () => {
  for (const requester of [null, '', 'user:bogus', 'guest:', 'guest:bad\tsession', `guest:${'x'.repeat(257)}`, 'admin:' + ID]) {
    const h = harness(), headers = { 'X-Concierge-Durable': '0', ...(requester !== null ? { 'X-Concierge-Requester': requester } : {}) }
    const res = await h.request({ method: 'POST', endpoint: 'main', headers })
    assert.equal(res.status, 409)
    assert.equal((await res.json()).code, 'requester_changed')
    noIO(h.calls)
  }
})
test('requester mismatch or auth uncertainty stops before quota/admin/provider', async () => {
  for (const [options, requester, code, status] of [
    [{ userId: ID }, `guest:${SESSION}`, 'requester_changed', 409],
    [{}, `user:${ID}`, 'requester_changed', 409],
    [{ userId: ID }, `user:${OTHER}`, 'requester_changed', 409],
    [{}, 'guest:other-session', 'requester_changed', 409],
    [{ authError: { name: 'AuthRetryableFetchError' } }, `guest:${SESSION}`, 'auth_unavailable', 503],
  ]) {
    const h = harness(options), res = await h.request({ method: 'POST', endpoint: 'main', headers: { ...fenced, 'X-Concierge-Requester': requester } })
    assert.equal(res.status, status); assert.equal((await res.json()).code, code)
    assert.equal(h.calls.auth, 1); assert.equal(h.calls.authFactory, 1)
    for (const key of ['admin', 'database', 'rate', 'memory', 'canonical', 'content', 'events', 'provider', 'writes']) assert.equal(h.calls[key], 0, key)
  }
})
test('legacy no-header callers and fenced guest/user sends retain normal replies and opaque sessions', async () => {
  for (const [options, headers, body] of [
    [{}, {}, legacy], [{}, fenced, legacy],
    [{ authError: { name: 'AuthSessionMissingError' } }, {}, legacy],
    [{ authError: { name: 'AuthSessionMissingError' } }, fenced, legacy],
    [{}, fenced, { ...legacy, session_id: `  ${SESSION}  ` }],
    [{ userId: ID }, { ...fenced, 'X-Concierge-Requester': `user:${ID}` }, { ...legacy, session_id: null }],
    [{}, {}, { ...legacy, surface: 'email', session_id: 'legacy-session:example-123' }],
  ]) {
    const h = harness(options), res = await h.request({ method: 'POST', endpoint: 'main', headers, body })
    assert.equal(res.status, 200, JSON.stringify({ options, headers, body }))
    const data = await res.json()
    assert.equal(data.message, 'Synthetic general reply'); assert.equal(data.conversation_id, ID)
    assert.equal(h.calls.provider, 1); assert.equal(h.calls.writes, 1); assert.equal(h.calls.rate, 1)
  }
})
test('unfenced legacy auth outages and invalid tokens do not silently select guest identity', async () => {
  for (const name of ['AuthRetryableFetchError', 'AuthApiError', 'AuthInvalidTokenResponseError']) {
    for (const userId of [null, ID]) {
      const h = harness({ userId, authError: { name } })
      const res = await h.request({ method: 'POST', endpoint: 'main', headers: {} })
      assert.equal(res.status, 503)
      const data = await res.json()
      assert.equal(data.code, 'auth_unavailable'); noReplay(data)
      assert.equal(h.calls.auth, 1)
      for (const key of ['admin', 'database', 'rate', 'memory', 'canonical', 'content', 'events', 'provider', 'writes']) assert.equal(h.calls[key], 0, key)
    }
  }
})
test('status never reads body or accesses any ledger/auth/provider, echoes nothing and grants no replay', async () => {
  for (const env of [{}, { CONCIERGE_DURABLE_MODE: 'on' }, { CONCIERGE_TEXT_MAINTENANCE: 'on' }, { CONCIERGE_DURABLE_MODE: 'bad' }]) {
    for (const headers of [{}, fenced, { 'X-Concierge-Durable': '1', 'X-Concierge-Requester': `guest:${SESSION}` }, { 'X-Concierge-Durable': 'garbage' }]) {
      const h = harness({ env }), res = await h.request({ method: 'POST', headers, body: { ...legacy, request_id: ID, message: 'secret message' } })
      assert.equal(res.status, 503); assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
      const data = await res.json(); assert.equal(data.code, 'status_unavailable'); noReplay(data)
      assert.equal(JSON.stringify(data).includes('secret message'), false); noIO(h.calls)
    }
  }
})
test('status uses existing origin restrictions including exact same-origin aliases', async () => {
  for (const origin of [ORIGIN, 'https://cafe-sativa.com', 'https://www.cafe-sativa.com', 'https://tru-skool-mall-test.vercel.app', 'https://virtual-cafe-sativa-test.vercel.app', 'http://localhost:3000', null]) {
    const h = harness(), res = await h.request({ origin })
    assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), origin); noIO(h.calls)
  }
  for (const origin of ['https://virtual.cafe-sativa.com', 'https://virtual-cafe-sativa.vercel.app']) {
    const h = harness(), res = await h.request({ origin, url: `${origin}/api/concierge/status` })
    assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), null); noIO(h.calls)
    assert.equal((await h.request({ origin })).status, 403)
  }
  for (const origin of ['https://evil.example', 'null', 'https://mall.truskool.net.evil.example', 'https://tru-skool-mall-x.vercel.app.evil.example', 'http://mall.truskool.net']) {
    for (const method of ['GET', 'POST']) {
      const h = harness(), res = await h.request({ method, origin, url: `${origin === 'null' ? 'https://evil.example' : origin}/api/concierge/status` })
      assert.equal(res.status, 403); assert.equal(res.headers.get('access-control-allow-origin'), null)
      assert.equal(res.headers.get('cache-control'), 'no-store'); noReplay(await res.json()); noIO(h.calls)
    }
  }
})
test('real preflight permits only existing origins and required GET/POST headers without credentials', async () => {
  for (const endpoint of ['status', 'main']) {
    const h = harness(), res = await h.request({ endpoint, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-concierge-durable,x-concierge-requester' } })
    assert.equal(res.status, 204); assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
    assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS')
    assert.match(res.headers.get('access-control-allow-headers'), /X-Concierge-Durable, X-Concierge-Requester/)
    assert.equal(res.headers.get('access-control-allow-credentials'), null)
    if (endpoint === 'status') assert.equal(res.headers.get('cache-control'), 'no-store')
    const rejected = await h.request({ endpoint, method: 'OPTIONS', origin: 'https://evil.example' })
    assert.equal(rejected.headers.get('access-control-allow-origin'), null); noIO(h.calls)
  }
})
