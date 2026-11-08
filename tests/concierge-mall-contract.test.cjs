const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { test } = require('node:test')
const { harness, ID, OTHER, SESSION, legacy } = require('./helpers/concierge-harness.cjs')

// Byte-identical reviewed Mall source: mall-chat-durable-work/js/concierge-transport.mjs.
// SHA256: 52d8a72009106fd3dfaf24e5ead3c7fd43e42ac28f704512328e028cf80347b9
// Production transport + production Café routes/helpers; only storage, Web Locks,
// timers, fetch routing, Supabase and provider I/O are injected. No network or DB.
const mall = import('./fixtures/mall-concierge-transport.mjs')
const completed = { state: 'COMPLETED', response: { message: 'Persisted original reply', memory_saved: true, conversation_id: ID } }
const NOW = 1794147756000
function storage() {
  const items = new Map()
  return { get length() { return items.size }, key(i) { return [...items.keys()][i] ?? null },
    getItem(k) { return items.get(k) ?? null }, setItem(k, v) { items.set(k, v) }, removeItem(k) { items.delete(k) } }
}
async function setup(options = {}, intercept) {
  const mod = await mall, h = harness(options), disk = storage(), wire = []
  const transport = mod.createConciergeTransport({ getStorage: () => disk,
    locks: { request: async (_key, _options, run) => run({}) }, now: () => NOW, randomUUID: () => ID,
    setTimer: () => 1, clearTimer() {}, fetcher: async (url, init) => {
      wire.push({ url, ...init })
      assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store')
      const args = { endpoint: url.endsWith('/status') ? 'status' : 'main', method: init.method,
        ...(init.body ? { body: JSON.parse(init.body) } : {}), headers: init.headers }
      const response = await h.request(args)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      return intercept ? intercept(response, args, h, wire) : response
    } })
  function retain() {
    const body = { ...legacy, conversation_id: null, room_id: null, ...mod.createRequestIdentity(NOW, ID) }
    const record = { version: 1, mode: 'durable', id: body.request_id, host: body.host,
      session: SESSION, requester: `guest:${SESSION}`, body: JSON.stringify(body) }
    mod.createPendingStore(() => disk).save(record)
    return record
  }
  return { h, transport, wire, retain }
}
const pending = t => t.inspect('laviche', SESSION).pending

test('reviewed Mall fixture is pinned byte-for-byte', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('./fixtures/mall-concierge-transport.mjs'))).digest('hex'), '52d8a72009106fd3dfaf24e5ead3c7fd43e42ac28f704512328e028cf80347b9')
})
test('completed exact-ID recovery works during OFF and maintenance without provider or admission', async () => {
  for (const env of [{}, { CONCIERGE_TEXT_MAINTENANCE: 'on' }, { CONCIERGE_DURABLE_MODE: 'on', CONCIERGE_TEXT_MAINTENANCE: 'on' }]) {
    const { h, transport, retain, wire } = await setup({ env, rpcResult: completed })
    const record = retain(), result = await transport.recover('laviche', SESSION)
    assert.equal(result.kind, 'reply'); assert.equal(result.message, completed.response.message)
    assert.equal(pending(transport).length, 0); assert.equal(wire.length, 1)
    assert.equal(wire[0].body, record.body); assert.equal(h.rpcCalls[0].name, 'concierge_status_v1')
    assert.equal(h.rpcCalls[0].args.p_request_id, record.id); assert.equal(h.calls.provider, 0)
  }
})
test('OFF and maintenance read ledger but suppress RESERVED and MISSING replay authority', async () => {
  for (const env of [{}, { CONCIERGE_DURABLE_MODE: 'on', CONCIERGE_TEXT_MAINTENANCE: 'on' }]) {
    for (const rpcResult of [{ state: 'RESERVED', recovery_required: true }, { error: 'request_missing', recovery_required: true }]) {
      const { h, transport, retain, wire } = await setup({ env, rpcResult }); const record = retain()
      const result = await transport.recover('laviche', SESSION)
      assert.equal(result.resolved, false); assert.equal(wire.length, 1)
      assert.equal(pending(transport)[0].body, record.body); assert.equal(h.calls.provider, 0)
      assert.equal(h.rpcCalls.length, 1)
    }
  }
})
test('ON permits authorized MISSING and RESERVED recovery using only the exact retained request', async () => {
  for (const statusResult of [{ error: 'request_missing', recovery_required: true }, { state: 'RESERVED', recovery_required: true }]) {
  const { h, transport, retain, wire } = await setup({ env: { CONCIERGE_DURABLE_MODE: 'on' },
    rpcResult: name => name === 'concierge_status_v1' ? statusResult : completed })
  const record = retain(), result = await transport.recover('laviche', SESSION)
  assert.equal(result.kind, 'reply'); assert.equal(pending(transport).length, 0)
  assert.equal(wire.length, 2); assert.equal(wire[0].body, record.body); assert.equal(wire[1].body, record.body)
  assert.deepEqual(h.rpcCalls.map(c => c.name), ['concierge_status_v1', 'concierge_admit_v1'])
  assert.equal(h.calls.provider, 0)
  }
})
test('pending, UNCERTAIN and malformed or contradictory ledger outcomes stay retained without replay', async () => {
  for (const rpcResult of [
    { state: 'RESERVED', recovery_required: false }, { state: 'DISPATCHING' }, { state: 'UNCERTAIN' },
    { state: 'UNCERTAIN', recovery_required: true }, { state: 'DISPATCHING', recovery_required: true },
    { state: 'WHAT', recovery_required: true }, { state: 'COMPLETED', response: { message: 'Unsaved', memory_saved: false } },
    { error: 'request_missing', recovery_required: false },
    { error: 'request_missing', recovery_required: true, state: 'UNCERTAIN' },
    { error: 'request_missing', recovery_required: true, terminal: true }, null, [],
  ]) {
    const { h, transport, retain, wire } = await setup({ env: { CONCIERGE_DURABLE_MODE: 'on' }, rpcResult })
    const record = retain(), result = await transport.recover('laviche', SESSION)
    assert.equal(result.resolved, false, JSON.stringify(rpcResult)); assert.equal(wire.length, 1, JSON.stringify(rpcResult))
    assert.equal(pending(transport)[0].body, record.body); assert.equal(h.calls.provider, 0)
  }
})
test('lost durable response recovers exact original identity without a second admission', async () => {
  let lost = false
  const { h, transport, wire } = await setup({ env: { CONCIERGE_DURABLE_MODE: 'on' }, rpcResult: completed }, (response, args) => {
    if (args.endpoint === 'main' && !lost) { lost = true; throw Error('Response lost after server completion') }
    return response
  })
  const first = await transport.send(legacy)
  assert.equal(first.resolved, false); const record = pending(transport)[0]
  const result = await transport.recover('laviche', SESSION)
  assert.equal(result.kind, 'reply'); assert.equal(wire[1].body, record.body); assert.equal(wire[2].body, record.body)
  assert.deepEqual(h.rpcCalls.map(c => c.name), ['concierge_admit_v1', 'concierge_status_v1'])
  assert.equal(pending(transport).length, 0)
})
test('identity mismatch retains original and prevents ledger or provider access', async () => {
  const { h, transport, retain, wire } = await setup({ userId: OTHER, rpcResult: completed }); const record = retain()
  const result = await transport.recover('laviche', SESSION)
  assert.equal(result.code, 'requester_changed'); assert.equal(result.resolved, false)
  assert.equal(pending(transport)[0].body, record.body); assert.equal(wire.length, 1)
  assert.equal(h.calls.admin, 0); assert.equal(h.calls.provider, 0)
})
test('legacy Mall send uses explicit OFF fence and no durable identity', async () => {
  const { h, transport, wire } = await setup()
  const result = await transport.send(legacy)
  assert.equal(result.kind, 'reply'); assert.equal(wire.length, 2); assert.equal(h.calls.provider, 1)
  const body = JSON.parse(wire[1].body)
  assert.equal('request_id' in body, false); assert.equal('issued_at' in body, false)
  assert.equal(wire[1].headers['X-Concierge-Durable'], '0'); assert.equal(pending(transport).length, 0)
})
test('capability-to-send mode flips retain requests without unsafe non-admission claims', async () => {
  for (const initial of ['off', 'on']) {
    const env = { CONCIERGE_DURABLE_MODE: initial }
    const { h, transport, wire } = await setup({ env }, (response, args) => {
      if (args.method === 'GET') h.env.CONCIERGE_DURABLE_MODE = initial === 'on' ? 'off' : 'on'
      return response
    })
    const result = await transport.send(legacy)
    assert.equal(result.resolved, false); assert.equal(result.code, initial === 'on' ? 'durable_disabled' : 'mode_changed')
    assert.equal(pending(transport).length, 1); assert.equal(wire.length, 2)
    assert.equal(h.calls.auth, 0); assert.equal(h.calls.provider, 0); assert.equal(h.calls.database, 0)
  }
})
test('rollback refuses durable body under missing or OFF header, including null identities', async () => {
  for (const header of [null, '0']) for (const identity of [{ request_id: ID }, { request_id: null }, { issued_at: null }]) {
    const h = harness(), response = await h.request({ endpoint: 'main', method: 'POST', body: { ...legacy, ...identity },
      headers: header === null ? {} : { 'X-Concierge-Durable': header, 'X-Concierge-Requester': `guest:${SESSION}` } })
    const data = await response.json()
    assert.equal(response.status, 409); assert.equal(data.code, 'mode_changed'); assert.equal('admitted' in data, false)
    assert.equal(h.calls.auth, 0); assert.equal(h.calls.database, 0); assert.equal(h.calls.provider, 0)
  }
})

test('fresh durable Mall send dispatches once, commits, and recovers a lost response by exact identity', async () => {
  let saved, lost = false
  const { h, transport, wire } = await setup({ env: { CONCIERGE_DURABLE_MODE: 'on' }, rpcResult: (name, args) => {
    if (name === 'concierge_admit_v1') return {
      admitted: true, state: 'RESERVED', requester: `s:${SESSION}`, owner_token: OTHER, conversation_id: ID,
      policy: { version: 1, max_prompt_bytes: 48000, max_input_messages: 61, max_output_tokens: 512, max_reply_chars: 16384 },
    }
    if (name === 'concierge_dispatch_v1') return { dispatch_granted: true, state: 'DISPATCHING' }
    if (name === 'concierge_complete_v1') {
      saved = { state: 'COMPLETED', response: { message: args.p_reply, memory_saved: true, conversation_id: ID } }
      return saved
    }
    if (name === 'concierge_status_v1' && saved) return saved
    throw Error(`Unexpected RPC: ${name}`)
  } }, (response, args) => {
    if (args.endpoint === 'main' && !lost) { lost = true; throw Error('Lost response after commit') }
    return response
  })
  const first = await transport.send(legacy)
  assert.equal(first.resolved, false)
  const record = pending(transport)[0], body = JSON.parse(record.body)
  assert.equal(body.issued_at, NOW)
  assert.equal(body.request_id, (await mall).createRequestIdentity(NOW, ID).request_id)
  assert.equal(h.calls.provider, 1)
  assert.deepEqual(h.rpcCalls.map(c => c.name), ['concierge_admit_v1', 'concierge_dispatch_v1', 'concierge_complete_v1'])
  for (const call of h.rpcCalls) assert.equal(call.args.p_request_id, record.id)
  for (const call of h.rpcCalls.slice(1)) {
    assert.equal(call.args.p_requester, `s:${SESSION}`); assert.equal(call.args.p_owner_token, OTHER)
  }
  const admission = h.rpcCalls[0].args
  assert.deepEqual(JSON.parse(JSON.stringify(admission.p_payload)), { version: 2, issued_at: NOW,
    host: body.host, message: body.message, conversation_id: body.conversation_id, surface: body.surface, room_id: body.room_id })
  assert.equal(h.rpcCalls[2].args.p_provider_terminal, true)
  assert.equal(h.rpcCalls[2].args.p_user_text, body.message)
  assert.equal(h.rpcCalls[2].args.p_reply, 'Synthetic general reply')
  const recovered = await transport.recover('laviche', SESSION)
  assert.equal(recovered.kind, 'reply'); assert.equal(recovered.message, 'Synthetic general reply')
  assert.equal(h.calls.provider, 1); assert.equal(pending(transport).length, 0)
  assert.deepEqual(h.rpcCalls.map(c => c.name), ['concierge_admit_v1', 'concierge_dispatch_v1', 'concierge_complete_v1', 'concierge_status_v1'])
  assert.equal(h.rpcCalls[3].args.p_request_id, admission.p_request_id)
  assert.deepEqual(h.rpcCalls[3].args.p_payload, admission.p_payload)
  assert.equal(wire[1].body, record.body); assert.equal(wire[2].body, record.body)
})
