const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const ID = '12345678-1234-1234-1234-123456789abc'
function harness(options = {}) {
  const calls = { provider: 0, writes: [], rate: [], memory: [], auth: 0, database: 0 }
  const event = { id: '00e7d9c6-61b9-4af9-827e-b6d13310b762', slug: 'hit-em-release-party',
    title: 'Hit Em Release Party', starts_at: '2026-11-11T06:00:00Z', ends_at: null,
    status: 'scheduled', ticket_price_cents: 0, access: 'free', description: '', free_for_tiers: [] }
  const admin = { from(table) {
    calls.database++
    let inserting = false
    const query = {
      select() { return this }, eq() { return this }, gte() { return this }, is() { return this },
      order() { return this }, limit() { return this }, in() { return this },
      insert(value) { inserting = true; calls.writes.push({ table, value }); return this },
      single() { return this }, maybeSingle() { return this },
      then(resolve) {
        if (table === 'memberships') return Promise.resolve(resolve({ data: options.membership ?? null, error: options.membershipError ?? null }))
        if (table === 'host_conversations') return Promise.resolve(resolve({ data: {
          id: ID, user_id: options.conversationUser ?? null, session_id: ID, host_agent: 'laviche', ended_at: null,
        }, error: options.conversationError ?? null }))
        return Promise.resolve(resolve({ data: inserting ? null : [], error: inserting ? options.persistError ?? null : options.historyError ?? null }))
      },
    }
    return query
  } }
  function load(file) {
    const context = { exports: {}, Date, Intl, URL, Set, console: { error() {} },
      process: { env: options.configured ? { ANTHROPIC_API_KEY: 'synthetic-only' } : {} },
      require(name) {
        if (name === 'next/server') return { NextResponse: class {
          static json(body, init = {}) { return { body, status: init.status ?? 200, headers: init.headers ?? {} } }
        } }
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
        if (name.endsWith('/supabase/server')) return { createClient: () => ({ auth: { getUser: async () => {
          calls.auth++
          return { data: { user: options.userId ? { id: options.userId } : null } }
        } } }) }
        if (name.endsWith('/supabase/admin')) return { createAdminClient: () => admin }
        if (name.endsWith('/personas')) return { getHost: host => host === 'laviche' ? { id: host, system_prompt: 'Approved host' } : null }
        if (name.endsWith('/rate-limit')) return { checkRateLimit: async params => {
          calls.rate.push(params)
          return options.usageUnavailable ? { allowed: false, unavailable: true, message: 'Availability check failed', resetsInSeconds: 30 }
            : options.denied ? { allowed: false, message: 'Limit reached', resetsInSeconds: 60 }
            : { allowed: true, remaining: 10, resetsInSeconds: 3600 }
        } }
        if (name.endsWith('/memory')) return { getMemoryContext: async params => {
          calls.memory.push(params)
          if (options.memoryError) throw new Error('Synthetic memory failure')
          return []
        } }
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
  return { calls, post: (body = {}) => route.POST({ url: options.url ?? 'https://www.cafe-sativa.com/api/concierge', json: async () => ({ host: 'laviche',
    message: 'Hi Laviche. For the Hit Em premiere, when does it start in Dallas, is it free, and where do I join the shared live chat?',
    session_id: ID, surface: 'web-chat', ...body }), headers: { get: name => name === 'origin' ? options.origin ?? null : null } }) }
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
  const inaccessible = await other.post({ conversation_id: ID })
  assert.equal(inaccessible.status, 403)
  assert.equal(inaccessible.body.code, 'conversation_unavailable')
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
test('malformed IDs/types are rejected before usage, history, provider or writes', async () => {
  for (const body of [{ session_id: {} }, { session_id: '' }, { session_id: 42 },
    { session_id: 'x'.repeat(257) }, { session_id: 'session\u0000id' },
    { conversation_id: false }, { conversation_id: '' }, { conversation_id: [] },
    { room_id: {} }, { room_id: 'x'.repeat(129) }, { host: ['laviche'] },
    { surface: ['web-chat'] }, { message: 'x'.repeat(2001) }, { message: ' ' }]) {
    const h = harness({ configured: true })
    assert.equal((await h.post(body)).status, 400)
    assert.equal(h.calls.rate.length, 0)
    assert.equal(h.calls.provider, 0)
    assert.equal(h.calls.writes.length, 0)
  }
})
test('legacy opaque guest sessions remain compatible for mall and email surfaces', async () => {
  for (const [surface, session] of [['mall-3d', 'mall-1794147756000-abc12345'], ['email', 'legacy-session:example-123']]) {
    const h = harness()
    const response = await h.post({ session_id: `  ${session}  `, surface })
    assert.equal(response.status, 200)
    assert.equal(h.calls.rate[0].sessionId, session)
    assert.equal(h.calls.rate[0].tier, 'anonymous')
  }
})
test('expired or invalid memberships receive Explorer limits; valid paid period keeps its tier', async () => {
  for (const [membership, expected] of [
    [{ tier: 'vip', status: 'active', current_period_end: '2000-01-01T00:00:00Z' }, 'explorer'],
    [{ tier: 'vip', status: 'active', current_period_end: null }, 'explorer'],
    [{ tier: 'vip', status: 'canceled', current_period_end: '2999-01-01T00:00:00Z' }, 'explorer'],
    [{ tier: 'made-up', status: 'active', current_period_end: '2999-01-01T00:00:00Z' }, 'explorer'],
    [{ tier: 'regular', status: 'active', current_period_end: '2999-01-01T00:00:00Z' }, 'regular'],
    [{ tier: 'vip', status: 'active', current_period_end: '2999-01-01T00:00:00Z' }, 'vip'],
  ]) {
    const h = harness({ userId: ID, membership })
    assert.equal((await h.post()).status, 200)
    assert.equal(h.calls.rate[0].tier, expected)
  }
})
test('usage, membership and history failures stop provider work without treating infrastructure failure as quota exhaustion', async () => {
  for (const options of [{ usageUnavailable: true }, { membershipError: {}, userId: ID },
    { conversationError: {} }, { historyError: {} }, { memoryError: true }]) {
    const h = harness({ configured: true, ...options })
    const response = await h.post({ message: 'Hello' })
    assert.equal(response.status, 503)
    assert.notEqual(response.body.rate_limited, true)
    assert.equal(h.calls.provider, 0)
    assert.equal(h.calls.writes.length, 0)
  }
})
test('current conversation is excluded from prior memory; failed save delivers answer with explicit warning', async () => {
  const h = harness({ persistError: {} })
  const response = await h.post()
  assert.equal(h.calls.memory[0].excludeConversationId, ID)
  assert.equal(response.status, 200)
  assert.equal(response.body.memory_saved, false)
  assert.match(response.body.warning, /could not be saved/)
  assert.match(response.body.message, /Hit Em/)
})
test('unapproved browser origin is rejected before any paid or database work', async () => {
  const denied = harness({ origin: 'https://unrelated.invalid', configured: true })
  const response = await denied.post()
  assert.equal(response.status, 403)
  assert.equal(response.body.code, 'origin_not_allowed')
  assert.equal(denied.calls.auth, 0)
  assert.equal(denied.calls.database, 0)
  assert.equal(denied.calls.rate.length, 0)
  assert.equal(denied.calls.provider, 0)
  assert.equal(denied.calls.writes.length, 0)
  assert.equal((await harness({ origin: 'https://www.cafe-sativa.com' }).post()).status, 200)
})
test('real origin resolver permits documented same-origin aliases without expanding cross-origin access', async () => {
  for (const origin of ['https://virtual.cafe-sativa.com', 'https://virtual-cafe-sativa.vercel.app']) {
    const same = harness({ origin, url: `${origin}/api/concierge` })
    const response = await same.post({ conversation_id: ID })
    assert.equal(response.status, 200)
    assert.equal(response.body.conversation_id, ID)
    assert.equal(same.calls.auth, 1)
    assert.equal(same.calls.writes.length, 1)
    assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
    const cross = harness({ origin })
    assert.equal((await cross.post()).status, 403)
    assert.equal(cross.calls.auth, 0)
    assert.equal(cross.calls.database, 0)
  }
})
test('real origin resolver retains approved mall/preview callers and rejects untrusted same-origin hosts', async () => {
  for (const origin of ['https://mall.truskool.net', 'https://virtual-cafe-sativa-preview.vercel.app']) {
    const response = await harness({ origin }).post()
    assert.equal(response.status, 200)
    assert.equal(response.headers['Access-Control-Allow-Origin'], origin)
  }
  for (const origin of ['https://unrelated.invalid', 'http://virtual.cafe-sativa.com', 'null',
    'https://virtual.cafe-sativa.com.unrelated.invalid']) {
    const denied = harness({ origin, url: `${origin}/api/concierge` })
    assert.equal((await denied.post()).status, 403)
    assert.equal(denied.calls.auth, 0)
    assert.equal(denied.calls.database, 0)
    assert.equal(denied.calls.provider, 0)
  }
})
