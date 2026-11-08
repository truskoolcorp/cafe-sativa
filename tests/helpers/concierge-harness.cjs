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

function harness({ env = {}, userId = null, authError = null, rpcResult = null, rpcError = null } = {}) {
  const calls = { authFactory: 0, auth: 0, admin: 0, database: 0, rate: 0, memory: 0, canonical: 0, content: 0, events: 0, provider: 0, writes: 0, body: 0 }
  const cache = new Map()
  const runtimeEnv = { ANTHROPIC_API_KEY: 'synthetic-test-only', ...env }
  const rpcCalls = []
  const admin = { async rpc(name, args) { calls.database++; rpcCalls.push({ name, args }); return { data: typeof rpcResult === 'function' ? await rpcResult(name, args) : rpcResult, error: rpcError } }, from(table) {
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
    const context = { exports, Buffer, Date, Intl, URL, Set, Request, Response, Headers,
      process: { env: runtimeEnv },
      console: { error() {} }, fetch() { throw Error('Real network is forbidden in this test') },
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
        if (name.startsWith('.')) return load(path.join(path.dirname(file), name) + '.ts')
        throw Error(`Unexpected dependency: ${name}`)
      },
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
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
  return { calls, request, status, rpcCalls, env: runtimeEnv }
}
module.exports = { harness, ID, OTHER, ORIGIN, URL_BASE, SESSION, legacy, fenced }
