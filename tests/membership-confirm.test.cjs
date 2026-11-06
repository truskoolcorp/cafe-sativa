const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const source = ts.transpileModule(fs.readFileSync('app/api/membership/confirm/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
function setup(options = {}) {
  const calls = [], exports = {}
  const session = { id: 'cs_test_receipt', mode: 'subscription', status: 'complete', payment_status: 'paid',
    metadata: { site: 'cafe-sativa', user_id: 'buyer', tier: 'regular' },
    customer: 'cus_buyer', subscription: 'sub_buyer', ...options.session }
  vm.runInNewContext(source, { exports, URL, process: { env: { STRIPE_SECRET_KEY: options.noKey ? '' : 'test-only' } }, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, ...options }) } }
    if (name === 'stripe') return { default: class { constructor() { this.checkout = { sessions: { retrieve: async id => {
      calls.push(['retrieve', id]); if (options.providerError) throw Error('private provider detail'); return session
    } } } } } }
    if (name.endsWith('/server')) return { createClient: () => ({ auth: { getUser: async () => ({ data: { user: options.noUser ? null : { id: 'buyer' } }, error: options.authError }) } }) }
    if (name.endsWith('/admin')) return { createAdminClient: () => ({ testAdmin: true }) }
    if (name.endsWith('/sync-membership')) return { syncCafeMembership: async (admin, stripe, input) => {
      calls.push(['sync', input]); if (options.syncError) throw Error('concurrent replacement'); return options.result || 'applied'
    } }
    throw Error(name)
  } })
  return { calls, run: (body = { sessionId: 'cs_test_receipt' }, origin = 'https://www.cafe-sativa.com') => exports.POST({
    url: 'https://www.cafe-sativa.com/api/membership/confirm', headers: { get: () => origin }, json: async () => body,
  }) }
}
test('first paid checkout can recover through guarded membership sync', async () => {
  const h = setup(), result = await h.run()
  assert.equal(result.status, 200); assert.equal(result.body.synchronized, true)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['retrieve', 'cs_test_receipt'], ['sync', {
    userId: 'buyer', subscriptionId: 'sub_buyer', mode: 'checkout', expectedCustomer: 'cus_buyer', expectedTier: 'regular',
  }]])
})
test('cross-origin, anonymous, invalid and missing references never reach Stripe', async () => {
  for (const [options, body, origin, status] of [
    [{}, undefined, 'https://other.test', 403], [{ noUser: true }, undefined, undefined, 401],
    [{ authError: 'expired' }, undefined, undefined, 401], [{}, {}, undefined, 400],
    [{}, { sessionId: 'other' }, undefined, 400], [{}, { sessionId: 'cs_' + 'a'.repeat(251) }, undefined, 400],
    [{ noKey: true }, undefined, undefined, 503],
  ]) { const h = setup(options); assert.equal((await h.run(body, origin)).status, status); assert.equal(h.calls.length, 0) }
})
for (const [label, patch] of [
  ['foreign user', { metadata: { site: 'cafe-sativa', user_id: 'other', tier: 'regular' } }],
  ['foreign site', { metadata: { site: 'other', user_id: 'buyer', tier: 'regular' } }],
  ['missing site', { metadata: { user_id: 'buyer', tier: 'regular' } }],
  ['invalid tier', { metadata: { site: 'cafe-sativa', user_id: 'buyer', tier: 'free' } }],
  ['wrong receipt', { id: 'cs_other' }], ['one-time purchase', { mode: 'payment' }],
  ['unpaid', { payment_status: 'unpaid' }], ['unknown payment', { payment_status: 'unknown' }],
  ['open', { status: 'open' }], ['expired', { status: 'expired' }],
  ['no customer', { customer: null }], ['no subscription', { subscription: null }],
]) test(label + ' never writes membership', async () => {
  const h = setup({ session: patch }); assert.equal((await h.run()).status, 409)
  assert.equal(h.calls.filter(call => call[0] === 'sync').length, 0)
})
test('expanded references and zero-due completed checkout still require guarded sync', async () => {
  const h = setup({ session: { payment_status: 'no_payment_required', customer: { id: 'cus_buyer' }, subscription: { id: 'sub_buyer' } } })
  assert.equal((await h.run()).status, 200); assert.equal(h.calls[1][1].expectedCustomer, 'cus_buyer')
})
test('ignored, concurrent and provider failures do not claim confirmation', async () => {
  for (const [options, status] of [[{ result: 'ignored' }, 409], [{ syncError: true }, 503], [{ providerError: true }, 503]]) {
    const h = setup(options), result = await h.run(); assert.equal(result.status, status)
    assert.notEqual(result.body.synchronized, true); assert(!JSON.stringify(result).includes('private provider detail'))
  }
})
test('return path includes Stripe reference, client submits POST and preserves signin return', () => {
  const checkout = fs.readFileSync('app/api/create-checkout-session/route.ts', 'utf8')
  const page = fs.readFileSync('app/membership/page.tsx', 'utf8')
  assert(checkout.includes('session_id={CHECKOUT_SESSION_ID}'))
  assert(page.includes("fetch('/api/membership/confirm'"))
  assert(page.includes('JSON.stringify({ sessionId: checkoutSessionId })'))
  assert(page.includes('encodeURIComponent(checkoutSessionId)'))
  assert(page.includes("window.location.assign('/account')"))
  assert(page.includes('result.synchronized !== true'))
})
