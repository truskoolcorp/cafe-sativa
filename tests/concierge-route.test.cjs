const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const ID = '12345678-1234-1234-1234-123456789abc'
function harness(options = {}) {
  const calls = { provider: 0, writes: [], rate: [] }
  const event = { id: '00e7d9c6-61b9-4af9-827e-b6d13310b762', slug: 'hit-em-release-party',
    title: 'Hit Em Release Party', starts_at: '2026-11-11T06:00:00Z', ends_at: null,
    status: 'scheduled', ticket_price_cents: 0, access: 'free', description: '', free_for_tiers: [] }
  const admin = { from(table) {
    let inserting = false
    const query = {
      select() { return this }, eq() { return this }, gte() { return this }, is() { return this },
      order() { return this }, limit() { return this }, in() { return this },
      insert(value) { inserting = true; calls.writes.push({ table, value }); return this },
      single() { return this }, maybeSingle() { return this },
      then(resolve) {
        if (table === 'memberships') return Promise.resolve(resolve({ data: options.membership ?? null }))
        if (table === 'host_conversations') return Promise.resolve(resolve({ data: {
          id: ID, user_id: options.conversationUser ?? null, session_id: ID, host_agent: 'laviche', ended_at: null,
        }, error: null }))
        return Promise.resolve(resolve({ data: inserting ? null : [], error: null }))
      },
    }
    return query
  } }
  function load(file) {
    const context = { exports: {}, Date, Intl, console: { error() {} },
      process: { env: options.configured ? { ANTHROPIC_API_KEY: 'synthetic-only' } : {} },
      require(name) {
        if (name === '@anthropic-ai/sdk') return { default: class {
          constructor() { calls.provider++ }
          messages = { create: async () => ({ content: [{ type: 'text', text: 'Synthetic general reply' }] }) }
        } }
        if (name.endsWith('/concierge-canon')) return { canonicalConciergeHost: async () => ({ context: 'Approved identity' }) }
        if (name.endsWith('/content/site')) return { getSiteContent: async () => {
          if (options.featureError) throw new Error('Synthetic feature outage')
          return []
        } }
        if (name === '@/lib/events') return { getUpcomingEvents: async () => options.events ?? [event] }
        if (name.endsWith('/supabase/server')) return { createClient: () => ({ auth: { getUser: async () => ({ data: { user: options.userId ? { id: options.userId } : null } }) } }) }
        if (name.endsWith('/supabase/admin')) return { createAdminClient: () => admin }
        if (name.endsWith('/personas')) return { getHost: host => host === 'laviche' ? { id: host, system_prompt: 'Approved host' } : null }
        if (name.endsWith('/rate-limit')) return { checkRateLimit: async params => {
          calls.rate.push(params)
          return options.denied ? { allowed: false, message: 'Limit reached', resetsInSeconds: 60 }
            : { allowed: true, remaining: 10, resetsInSeconds: 3600 }
        } }
        if (name.endsWith('/memory')) return { getMemoryContext: async () => [] }
        if (name.endsWith('/cors')) return { jsonWithCors: (body, init) => ({ body, status: init.status }), preflight() {} }
        if (name.startsWith('@/lib/')) return load(name.replace('@/', '') + '.ts')
        throw new Error(`Unexpected import: ${name}`)
      },
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context)
    return context.exports
  }
  const route = load('app/api/concierge/route.ts')
  return { calls, post: (body = {}) => route.POST({ json: async () => ({ host: 'laviche',
    message: 'Hi Laviche. For the Hit Em premiere, when does it start in Dallas, is it free, and where do I join the shared live chat?',
    session_id: ID, surface: 'web-chat', ...body }), headers: { get: () => null } }) }
}
test('verified launch FAQ returns and persists exact facts with no provider key or provider call', async () => {
  const h = harness({ featureError: true })
  const response = await h.post()
  assert.equal(response.status, 200)
  assert.match(response.body.message, /12:00 AM midnight CST/)
  assert.match(response.body.message, /no Café Sativa account, membership, or ticket/)
  assert.match(response.body.message, /ZYA0r9JM6eA/)
  assert.equal(h.calls.provider, 0)
  assert.equal(h.calls.rate.length, 1)
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.calls.writes[0].table, 'host_messages')
  assert.equal(h.calls.writes[0].value[1].content, response.body.message)
})
test('deterministic FAQ cannot bypass ownership or rate checks', async () => {
  const other = harness({ conversationUser: 'another-user' })
  assert.equal((await other.post({ conversation_id: ID })).status, 403)
  assert.equal(other.calls.writes.length, 0)
  const denied = harness({ denied: true })
  assert.equal((await denied.post()).status, 429)
  assert.equal(denied.calls.writes.length, 0)
})
test('unverified event cannot trigger the deterministic answer; general chat still uses the provider', async () => {
  const unavailable = harness({ events: [] })
  assert.equal((await unavailable.post()).status, 503)
  assert.equal(unavailable.calls.provider, 0)
  const general = harness({ configured: true })
  const response = await general.post({ message: 'Hello Laviche' })
  assert.equal(response.status, 200)
  assert.equal(response.body.message, 'Synthetic general reply')
  assert.equal(general.calls.provider, 1)
})
