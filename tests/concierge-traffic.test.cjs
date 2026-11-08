const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const assert = require('node:assert/strict'), { test } = require('node:test')
const ID = '12345678-1234-1234-1234-123456789abc'
function load(file, admin) {
  const context = { exports: {}, Map, Date, Number, console: { error() {} }, require(name) {
    if (name.endsWith('/supabase/admin')) return { createAdminClient: () => admin }
    if (name === './request') return load('lib/concierge/request.ts')
    if (name === './history') return load('lib/concierge/history.ts')
    throw new Error(name)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context)
  return context.exports
}
function database(result) {
  const calls = []
  const q = { then(resolve) { return Promise.resolve(resolve(result)) } }
  for (const method of ['select', 'eq', 'gte', 'is', 'in', 'order', 'limit', 'neq']) q[method] = (...args) => { calls.push([method, ...args]); return q }
  return { calls, from: () => q }
}
test('all exact tier caps deny at the limit and report remaining after the accepted turn', async () => {
  for (const [tier, cap, seconds] of [['anonymous', 10, 3600], ['explorer', 50, 86400], ['regular', 200, 86400], ['vip', 1000, 86400]]) {
    const params = { userId: tier === 'anonymous' ? null : ID, sessionId: ID, tier }
    let limiter = load('lib/concierge/rate-limit.ts', database({ count: cap - 1, error: null }))
    const last = await limiter.checkRateLimit(params)
    assert.equal(last.allowed, true)
    assert.equal(last.remaining, 0)
    assert.equal(last.resetsInSeconds, seconds)
    limiter = load('lib/concierge/rate-limit.ts', database({ count: cap, error: null }))
    assert.equal((await limiter.checkRateLimit(params)).allowed, false)
  }
})
test('unknown, failed and invalid usage counts fail closed; anonymous counts exclude authenticated conversations', async () => {
  for (const result of [{ error: {} }, { count: null }, { count: -1 }, { count: NaN }, { count: 1.5 }]) {
    const db = database(result)
    const outcome = await load('lib/concierge/rate-limit.ts', db).checkRateLimit({ userId: null, sessionId: ID, tier: 'anonymous' })
    assert.equal(outcome.allowed, false)
    assert.equal(outcome.unavailable, true)
    assert.ok(db.calls.some(c => c[0] === 'is' && c[1] === 'host_conversations.user_id' && c[2] === null))
  }
})
test('paid memory excludes current conversation and keeps stable user-before-assistant order', async () => {
  const db = database({ data: [{ role: 'assistant', content: 'Answer', created_at: 'same' }, { role: 'user', content: 'Question', created_at: 'same' }] })
  const memory = await load('lib/concierge/memory.ts', db).getMemoryContext({ userId: ID, hostAgent: 'laviche', tier: 'vip', excludeConversationId: ID })
  assert.equal(memory[0].role, 'user')
  assert.equal(memory[1].role, 'assistant')
  assert.ok(db.calls.some(c => c[0] === 'neq' && c[1] === 'conversation_id' && c[2] === ID))
  assert.ok(db.calls.some(c => c[0] === 'limit' && c[1] === 20))
  await assert.rejects(load('lib/concierge/memory.ts', database({ error: {} })).getMemoryContext({ userId: ID, hostAgent: 'laviche', tier: 'regular' }), /temporarily unavailable/)
  const sorted = load('lib/concierge/history.ts').chronologicalMessages([
    { role: 'assistant', content: 'Second answer', created_at: '2026-11-08T01:00:00Z' },
    { role: 'assistant', content: 'First answer', created_at: '2026-11-08T00:00:00Z' },
    { role: 'user', content: 'First question', created_at: '2026-11-08T00:00:00Z' },
    { role: 'user', content: 'Second question', created_at: '2026-11-08T01:00:00Z' },
  ])
  assert.equal(sorted.map(row => row.content).join(','), 'First question,First answer,Second question,Second answer')
})
test('blocked browser storage remains usable with stable UUID and isolated host/account continuity', () => {
  const { createChatStorage } = load('lib/concierge/browser-session.ts')
  let generated = 0
  const storage = createChatStorage(() => { throw new Error('Storage blocked') }, () => { generated++; return ID })
  assert.equal(storage.sessionId(), ID)
  assert.equal(storage.sessionId(), ID)
  assert.equal(generated, 1)
  storage.saveConversation('laviche', 'guest:a', ID)
  assert.equal(storage.conversationId('laviche', 'guest:a'), ID)
  assert.equal(storage.conversationId('ginger', 'guest:a'), null)
  assert.equal(storage.conversationId('laviche', 'user:a'), null)
  assert.equal(storage.conversationId('laviche', 'user:b'), null)
  storage.clearConversation('laviche', 'guest:a')
  assert.equal(storage.conversationId('laviche', 'guest:a'), null)
})
test('malformed saved sessions rotate; unscoped legacy conversations are not reused across accounts', () => {
  const items = new Map([['cafe-sativa:session-id', 'not-a-uuid'], ['cafe-sativa:conv-id:laviche', ID]])
  const backing = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }
  const storage = load('lib/concierge/browser-session.ts').createChatStorage(() => backing, () => ID)
  assert.equal(storage.sessionId(), ID)
  assert.equal(items.get('cafe-sativa:session-id'), ID)
  assert.equal(storage.conversationId('laviche', 'user:a'), null)
  storage.saveConversation('laviche', 'user:a', 'malformed')
  assert.equal(storage.conversationId('laviche', 'user:a'), null)
})
test('request parser rejects non-object payloads, nonstring coercion and malformed optional fields', () => {
  const { validateConciergeRequest: parse } = load('lib/concierge/request.ts')
  for (const value of [null, [], 'text', 1, true]) assert.equal(parse(value).valid, false)
  const body = { host: 'laviche', surface: 'web-chat', message: ' Hello ', session_id: ID }
  assert.equal(parse(body).body.message, 'Hello')
  assert.equal(parse(body).body.conversation_id, null)
  assert.equal(parse({ ...body, session_id: ' legacy-guest:123 ' }).body.session_id, 'legacy-guest:123')
  assert.equal(parse({ ...body, session_id: 'x'.repeat(256) }).valid, true)
  assert.equal(parse({ ...body, session_id: 'x'.repeat(257) }).valid, false)
  assert.equal(parse({ ...body, conversation_id: 'legacy-conversation' }).valid, false)
  for (const patch of [{ host: ['laviche'] }, { surface: ['web-chat'] }, { room_id: '\u0000' }, { session_id: [] }]) {
    assert.equal(parse({ ...body, ...patch }).valid, false)
  }
})

test('UUIDv7 replay issuance is immutable, bounded and binds all 48 timestamp bits', () => {
  const { createDurableRequestIdentity: create, durableRequestIssuedAt: issuedAt, validateConciergeRequest: parse }=load('lib/concierge/request.ts')
  for(const time of [0,1,Date.now(),0xffffffffffff]) {
    const id=create(time,ID)
    assert.equal(issuedAt(id.request_id),time)
    assert.match(id.request_id,/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const body={...id,host:'laviche',surface:'web-chat',message:'Original'}
    assert.equal(parse(body).valid,true)
    assert.equal(parse({...body,issued_at:time+1}).valid,false)
    assert.equal(parse({...body,issued_at:String(time)}).valid,false)
    assert.equal(parse({...body,request_id:ID}).valid,false)
  }
  for(const time of [-1,0.5,NaN,Infinity,0x1000000000000]) assert.throws(()=>create(time,ID))
  assert.equal(issuedAt(ID),null)
})
