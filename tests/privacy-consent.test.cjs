const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function load(path, extra = {}) {
  const context = { exports: {}, URL, Set, Date, Object, JSON, Number, ...extra }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, context)
  return context.exports
}
const consent = load('lib/analytics/privacy-consent.ts')
const now = 1794138600000
const record = (overrides = {}) => JSON.stringify({ version: consent.CONSENT_NOTICE_VERSION,
  updatedAt: now, analytics: true, marketing: true, ...overrides })
function store(options = {}) {
  const env = { value: options.value ?? null, now, gpc: false, writeError: false,
    readError: false, withdrawals: [], operations: [], latches: 0 }
  const instance = consent.createPrivacyConsentStore({
    read: () => { if (env.readError) throw Error('storage'); return env.value },
    write: value => { if (env.writeError) throw Error('storage'); env.value = value },
    now: () => env.now,
    globalPrivacyControl: () => env.gpc,
    onWithdrawal: persisted => { env.withdrawals.push(persisted); env.operations.push('reload') },
    onUnpersistedRejection: () => { env.latches++ },
  })
  return { env, instance }
}

test('SSR and initial client snapshot never grant consent', () => {
  const { instance } = store({ value: record() })
  assert.equal(instance.getSnapshot().analytics, false)
  assert.equal(instance.getSnapshot().marketing, false)
  assert.equal(instance.getServerSnapshot().decided, false)
  assert.equal(instance.getServerSnapshot(), instance.getServerSnapshot())
})
for (const [name, raw] of [
  ['missing', null], ['malformed', '{bad'], ['wrong version', record({ version: 'old' })],
  ['string grant', record({ marketing: 'true' })], ['missing category', record({ analytics: undefined })],
  ['expired', record({ updatedAt: now - consent.CONSENT_MAX_AGE_MS })],
  ['future date', record({ updatedAt: now + 1 })], ['bad timestamp', record({ updatedAt: null })],
]) test(`${name} stored data fails closed`, () => {
  const parsed = consent.parseConsent(raw, now)
  assert.equal(parsed.analytics, false); assert.equal(parsed.marketing, false)
  assert.equal(parsed.decided, false)
})
test('valid saved choices restore independently', () => {
  const { instance } = store({ value: record({ analytics: false }) })
  instance.refresh()
  assert.equal(instance.getSnapshot().analytics, false)
  assert.equal(instance.getSnapshot().marketing, true)
})
test('only an explicit boolean true grants consent', () => {
  const { instance } = store()
  instance.choose({ analytics: 'true', marketing: 1 })
  assert.equal(instance.getSnapshot().analytics, false)
  assert.equal(instance.getSnapshot().marketing, false)
})
test('reject saves only version, choices, decided flag and timestamp', () => {
  const { env, instance } = store()
  instance.choose({ analytics: false, marketing: false })
  assert.deepEqual(Object.keys(JSON.parse(env.value)).sort(), ['analytics', 'decided', 'marketing', 'updatedAt', 'version'])
  assert.equal(instance.getSnapshot().decided, true)
})
test('withdrawal notifies tracker listeners before reload', () => {
  const { env, instance } = store()
  instance.choose({ analytics: true, marketing: true })
  instance.subscribe(() => env.operations.push('revoke'))
  instance.choose({ analytics: false, marketing: false })
  assert.deepEqual(env.operations, ['revoke', 'reload'])
  assert.deepEqual(env.withdrawals, [true])
})
test('changing one category does not grant the other', () => {
  const { instance } = store()
  instance.choose({ analytics: true, marketing: false })
  assert.equal(instance.getSnapshot().marketing, false)
  instance.choose({ analytics: false, marketing: true })
  assert.equal(instance.getSnapshot().analytics, false)
})
test('cross-tab clearing, corrupting or denying a choice revokes consent', () => {
  for (const value of [null, '{bad', record({ analytics: false, marketing: false })]) {
    const { env, instance } = store({ value: record() })
    instance.refresh(); env.value = value; instance.refresh()
    assert.equal(instance.getSnapshot().marketing, false)
    assert.equal(instance.getSnapshot().analytics, false)
    assert.equal(env.withdrawals.length, 1)
  }
})
test('read errors cannot restore permission and revoke existing grants', () => {
  const { env, instance } = store({ value: record() })
  env.readError = true; instance.refresh()
  assert.equal(instance.getSnapshot().marketing, false)
  env.readError = false; instance.refresh()
  env.readError = true; instance.refresh()
  assert.equal(env.withdrawals.length, 1)
})
test('write failure preserves current-tab explicit choice, reports failure, and marks withdrawal unpersisted', () => {
  const { env, instance } = store({ value: record() })
  instance.refresh(); env.writeError = true
  assert.equal(instance.choose({ analytics: false, marketing: false }), false)
  assert.equal(instance.getSnapshot().marketing, false)
  assert.deepEqual(env.withdrawals, [false])
})
test('Global Privacy Control blocks saved and new permission', () => {
  const { env, instance } = store({ value: record() })
  env.gpc = true; instance.refresh()
  assert.equal(instance.getSnapshot().marketing, false)
  instance.choose({ analytics: true, marketing: true })
  assert.equal(instance.getSnapshot().analytics, false)
  assert.equal(instance.getSnapshot().marketing, false)
})
test('failed explicit rejection cannot resurrect a temporarily unreadable old saved grant', () => {
  const { env, instance } = store({ value: record() })
  env.readError = true; instance.refresh()
  env.writeError = true; instance.choose({ analytics: false, marketing: false })
  assert.equal(env.latches, 1)
  env.readError = false; instance.refresh()
  assert.equal(instance.getSnapshot().analytics, false)
  assert.equal(instance.getSnapshot().marketing, false)
})
test('a throwing listener cannot block other listeners or withdrawal reload', () => {
  const { env, instance } = store({ value: record() })
  instance.refresh()
  instance.subscribe(() => { throw Error('listener failed') })
  instance.subscribe(() => env.operations.push('revoke'))
  instance.choose({ analytics: false, marketing: false })
  assert.deepEqual(env.operations, ['revoke', 'reload'])
})
test('cookie cleanup failure cannot block the failed-save latch or document teardown', () => {
  const win = { name: '', localStorage: {
    getItem: () => record(), setItem: () => { throw Error('storage failed') },
  }, location: { reload: () => { reloads++ } } }
  let reloads = 0
  const doc = { set cookie(_) { throw Error('cookie blocked') } }
  const module = load('lib/analytics/privacy-consent.ts', { window: win, document: doc, navigator: {},
    Date: { now: () => now } })
  module.privacyConsent.refresh()
  module.privacyConsent.choose({ analytics: false, marketing: false })
  assert.equal(win.name, 'cafe-sativa:optional-tracking-revoked')
  assert.equal(reloads, 1)
  const reloaded = load('lib/analytics/privacy-consent.ts', { window: win, document: doc, navigator: {},
    Date: { now: () => now } })
  reloaded.privacyConsent.refresh()
  assert.equal(reloaded.privacyConsent.getSnapshot().marketing, false)
})
test('expiry during an open visit revokes existing permission', () => {
  const { env, instance } = store({ value: record() })
  instance.refresh(); env.now += consent.CONSENT_MAX_AGE_MS; instance.refresh()
  assert.equal(instance.getSnapshot().decided, false)
  assert.equal(env.withdrawals.length, 1)
})
test('unsubscribe prevents updates', () => {
  const { instance } = store(); let called = 0
  const stop = instance.subscribe(() => called++)
  instance.choose({ analytics: false, marketing: true }); stop()
  instance.choose({ analytics: false, marketing: false })
  assert.equal(called, 1)
})

const pixel = load('lib/analytics/meta-pixel.ts')
const metricool = load('lib/analytics/metricool.ts', { require: path => {
  assert.equal(path, './meta-pixel'); return pixel
} })
function analyticsBrowser() {
  const scripts = [], calls = []
  const win = { location: { href: 'https://www.cafe-sativa.com/' } }
  const doc = { referrer: '', getElementById: () => null,
    createElement: () => ({ remove() {} }), head: { appendChild: script => scripts.push(script) } }
  const controller = metricool.createMetricoolController(win, doc)
  const loaded = () => { win.beTracker = { t: options => calls.push(options) }; scripts[0].onload() }
  return { win, doc, scripts, calls, controller, loaded }
}
for (const [flag, grant] of [[false, false], [false, true], [true, false]]) {
  test(`Metricool creates no request when enabled=${flag}, analytics=${grant}`, () => {
    const b = analyticsBrowser(); b.controller.sync(flag, grant)
    assert.equal(b.scripts.length, 0)
  })
}
test('Metricool loads once only after analytics consent and flag', () => {
  const b = analyticsBrowser(); b.controller.sync(true, true); b.loaded()
  b.controller.sync(true, true); b.loaded()
  assert.equal(b.scripts.length, 1); assert.equal(b.calls.length, 1)
})
test('Metricool rechecks consent and URL after delayed loading', () => {
  for (const action of [b => b.controller.sync(true, false),
    b => { b.win.location.href = 'https://www.cafe-sativa.com/account' }]) {
    const b = analyticsBrowser(); b.controller.sync(true, true); action(b); b.loaded()
    assert.equal(b.calls.length, 0)
  }
})
test('Metricool does not overwrite an existing tracker', () => {
  const b = analyticsBrowser(); b.win.beTracker = { t() {} }; b.controller.sync(true, true)
  assert.equal(b.scripts.length, 0)
})
test('Metricool can finish loading off-scope then start once on a later allowed page', () => {
  const b = analyticsBrowser(); b.controller.sync(true, true)
  b.win.location.href = 'https://www.cafe-sativa.com/account'; b.loaded()
  assert.equal(b.calls.length, 0)
  b.win.location.href = 'https://www.cafe-sativa.com/events'; b.controller.sync(true, true)
  assert.equal(b.calls.length, 1)
})
test('layout has no unconditional script, noscript beacon, preconnect or preload for either tracker', () => {
  const layout = fs.readFileSync('app/layout.tsx', 'utf8')
  assert.doesNotMatch(layout, /next\/script|tracker\.metricool|connect\.facebook|noscript|preconnect/)
  assert.match(layout, /<PrivacyChoices \/>/)
  assert.match(fs.readFileSync('components/site/Footer.tsx', 'utf8'), /<PrivacyChoicesButton \/>/)
})
