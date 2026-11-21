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
  privateEnabled = false, rehearsal = false, invited = false, canDraft = false, windowOpen = true } = {}) {
  const exports = {}
  let calls = 0
  let providerRequest
  let roomBound = false
  const rows = {
    profiles: { is_staff: staff }, lounge_rooms: { id },
    lounge_messages: source ? { content: '[Ask ahnika] Tell me about the premiere' } : null,
    my_events_v: { title: 'Already Gone', starts_at: '2026-12-01T06:00:00Z' },
    stage_rehearsal_invites: invited ? { user_id: id, can_draft: canDraft } : null,
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
    '@/lib/events/ahnika-premiere-window': { ahnikaConciergeWindowOpen: () => windowOpen },
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
test('public concierge refuses drafts outside the premiere window before any provider call', async () => {
  const r = await fixture({ windowOpen: false })
  assert.equal(r.response.status, 409)
  assert.equal(r.calls, 0)
})

test('public window rejects early, expired, changed and canceled premieres', () => {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/events/ahnika-premiere-window.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date })
  const { AHNIKA_PREMIERE_START: start, AHNIKA_QA_END: end, ahnikaConciergeWindowOpen: open } = exports
  const row = { starts_at: start, presenter_name: 'Ahnika Merlot', ticket_price_cents: 0, status: 'scheduled' }
  assert.equal(open(row, Date.parse(start) - 1), false)
  assert.equal(open(row, Date.parse(start)), true)
  assert.equal(open(row, Date.parse(end) - 1), true)
  assert.equal(open(row, Date.parse(end)), false)
  assert.equal(open({ ...row, status: 'canceled' }, Date.parse(start)), false)
  assert.equal(open({ ...row, starts_at: end }, Date.parse(start)), false)
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
  const attendee = await fixture({ enabled: false, privateEnabled: true, rehearsal: true, invited: true, staff: true })
  assert.equal(attendee.response.status, 403)
  assert.equal(attendee.calls, 0)
  const r = await fixture({ enabled: false, privateEnabled: true, rehearsal: true, invited: true, canDraft: true, staff: false })
  assert.equal(r.response.status, 200)
  assert.match(r.providerRequest.system, /not a public performance/)
})
