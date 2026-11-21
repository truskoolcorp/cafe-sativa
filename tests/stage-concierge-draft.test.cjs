const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const vm = require('node:vm')
const fs = require('node:fs')
const code = ts.transpileModule(fs.readFileSync('app/api/lounge/concierge-draft/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText
const id = '00000000-0000-4000-8000-000000000001'
async function fixture({ enabled = true, staff = true, source = true, origin = 'https://preview.test', claimError = null,
  privateEnabled = false, rehearsal = false, invited = false } = {}) {
  const exports = {}
  let calls = 0
  let providerRequest
  let roomBound = false
  const rows = {
    profiles: { is_staff: staff }, lounge_rooms: { id },
    lounge_messages: source ? { content: '[Ask ahnika] Tell me about the premiere' } : null,
    my_events_v: { title: 'Already Gone' },
    stage_rehearsal_invites: invited ? { user_id: id } : null,
  }
  const db = {
    auth: { getUser: async () => ({ data: { user: { id } } }) },
    from(table) {
      if (table === 'stage_concierge_claims') return { insert: async () => ({ error: claimError }) }
      const q = { select: () => q, eq(key, value) {
        if (table === 'lounge_messages' && key === 'room_id' && value === id) roomBound = true
        return q
      }, gt: () => q, is: () => q, maybeSingle: async () => ({ data: rows[table] }) }
      return q
    },
  }
  const modules = {
    '@anthropic-ai/sdk': class { messages = { create: async args => {
      calls++; providerRequest = args
      return { content: [{ type: 'text', text: 'Welcome to The Stage.' }] }
    } } },
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    '@/lib/supabase/server': { createClient: () => db },
    '@/lib/concierge/personas': { getHost: () => ({ id: 'ahnika', display_name: 'Ahnika', system_prompt: 'Host persona' }) },
    '@/lib/content/concierge-canon': { canonicalConciergeHost: async () => ({ context: 'Verified host' }) },
    '@/lib/concierge/response-engine': { CONCIERGE_MODEL: 'fixture' },
    '@/lib/events/private-stage-rehearsal': { PRIVATE_STAGE_REHEARSAL_ROOM: '5cafe000-0000-4000-8000-000000000001' },
  }
  vm.runInNewContext(code, { exports, require: name => modules[name], URL,
    process: { env: { STAGE_CONCIERGE_DRAFTS_ENABLED: String(enabled), STAGE_PRIVATE_REHEARSAL_ENABLED: String(privateEnabled), ANTHROPIC_API_KEY: 'fixture' } } })
  const response = await exports.POST({ url: 'https://preview.test/api/lounge/concierge-draft',
    headers: { get: () => origin }, json: async () => ({ messageId: id, host: 'ahnika', rehearsal }) })
  return { response, calls, roomBound, providerRequest }
}

test('disabled, cross-origin and non-moderator requests never reach the provider', async () => {
  for (const [options, expected] of [[{ enabled: false }, 404], [{ origin: 'https://elsewhere.test' }, 403], [{ staff: false }, 403]]) {
    const r = await fixture(options)
    assert.equal(r.response.status, expected)
    assert.equal(r.calls, 0)
  }
})
test('missing or unverified source cannot generate a draft', async () => {
  const r = await fixture({ source: false })
  assert.equal(r.response.status, 404)
  assert.equal(r.calls, 0)
})
test('moderator receives a room-bound draft without an automated post', async () => {
  const r = await fixture()
  assert.equal(r.response.status, 200)
  assert.equal(r.calls, 1)
  assert.equal(r.roomBound, true)
  assert.equal(r.providerRequest.messages.length, 1)
  assert.match(r.response.body.attribution, /Ahnika/)
})
test('duplicate or rate-limited claim does not call the provider', async () => {
  const r = await fixture({ claimError: { code: '23505' } })
  assert.equal(r.response.status, 429)
  assert.equal(r.calls, 0)
})
test('private rehearsal requires invitation and does not enable public drafts', async () => {
  for (const options of [{ rehearsal: true }, { rehearsal: false, invited: true }]) {
    const r = await fixture({ enabled: false, privateEnabled: true, ...options })
    assert.equal(r.response.status, 404)
    assert.equal(r.calls, 0)
  }
  const r = await fixture({ enabled: false, privateEnabled: true, rehearsal: true, invited: true })
  assert.equal(r.response.status, 200)
  assert.match(r.providerRequest.system, /not a public performance/)
})
