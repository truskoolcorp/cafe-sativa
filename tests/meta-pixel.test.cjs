const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function load(path) {
  const context = { exports: {}, URL, Set }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, context)
  return context.exports
}

const pixel = load('lib/analytics/meta-pixel.ts')
function browser() {
  const scripts = [], calls = []
  const win = { location: { href: 'https://www.cafe-sativa.com/' } }
  const doc = {
    referrer: '',
    getElementById: () => null,
    createElement: () => ({ remove() { this.removed = true } }),
    head: { appendChild: script => scripts.push(script) },
  }
  const controller = pixel.createMetaPixelController(win, doc)
  const loadScript = (index = 0) => {
    win.fbq.callMethod = (...args) => calls.push(args)
    scripts[index].onload()
  }
  return { win, doc, scripts, calls, controller, loadScript }
}

function pageviews(b) { return b.calls.filter(c => c[0] === 'trackSingle') }

test('uses the supplied pixel ID, not the earlier unrelated screenshot ID', () => {
  assert.equal(pixel.CAFE_META_PIXEL_ID, '1079070821826891')
})

for (const [enabled, granted] of [[false, false], [false, true], [true, false]]) {
  test(`no requests or global tracker when enabled=${enabled}, consent=${granted}`, () => {
    const b = browser()
    b.controller.sync(enabled, granted)
    assert.equal(b.scripts.length, 0)
    assert.equal(b.win.fbq, undefined)
  })
}

test('after both gates pass, one script and one scoped PageView are emitted', () => {
  const b = browser()
  b.controller.sync(true, true)
  assert.equal(b.scripts.length, 1)
  assert.equal(b.scripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js')
  assert.equal(b.win.fbq.queue.length, 0)
  b.loadScript()
  assert.deepEqual(b.calls, [
    ['set', 'autoConfig', false, pixel.CAFE_META_PIXEL_ID],
    ['init', pixel.CAFE_META_PIXEL_ID],
    ['consent', 'grant'],
    ['trackSingle', pixel.CAFE_META_PIXEL_ID, 'PageView'],
  ])
})

test('repeated sync does not duplicate initialization, script, or pageviews', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.controller.sync(true, true)
  b.loadScript()
  b.controller.sync(true, true)
  b.controller.sync(true, true)
  assert.equal(b.scripts.length, 1)
  assert.equal(pageviews(b).length, 1)
  assert.equal(b.calls.filter(c => c[0] === 'init').length, 1)
})

test('SPA navigation and back each send one PageView', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.loadScript()
  b.win.location.href = 'https://www.cafe-sativa.com/events'
  b.controller.sync(true, true)
  b.controller.sync(true, true)
  b.win.location.href = 'https://www.cafe-sativa.com/'
  b.controller.sync(true, true)
  assert.equal(pageviews(b).length, 3)
})

test('navigation during script loading emits only the current allowed page', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.win.location.href = 'https://www.cafe-sativa.com/events'
  b.controller.sync(true, true)
  b.loadScript()
  assert.equal(pageviews(b).length, 1)
})

test('revocation during loading prevents all init and PageView calls', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.controller.sync(true, false)
  b.loadScript()
  assert.equal(b.calls.length, 0)
})

test('revocation after loading stops further PageViews and supports later regrant', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.loadScript()
  b.controller.sync(true, false)
  assert.deepEqual(b.calls.at(-1), ['consent', 'revoke'])
  b.win.location.href = 'https://www.cafe-sativa.com/events'
  b.controller.sync(true, false)
  assert.equal(pageviews(b).length, 1)
  b.controller.sync(true, true)
  assert.equal(pageviews(b).length, 2)
  assert.equal(b.scripts.length, 1)
})

test('disabling the feature after load revokes consent', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.loadScript()
  b.controller.sync(false, true)
  assert.deepEqual(b.calls.at(-1), ['consent', 'revoke'])
  assert.equal(pageviews(b).length, 1)
})

test('existing foreign fbq is not overwritten or used', () => {
  const b = browser(), foreign = () => assert.fail('foreign tracker invoked')
  b.win.fbq = foreign
  b.controller.sync(true, true)
  assert.equal(b.win.fbq, foreign)
  assert.equal(b.scripts.length, 0)
})

test('existing foreign _fbq alone is not overwritten or used', () => {
  const b = browser(), foreign = () => assert.fail('foreign tracker invoked')
  b.win._fbq = foreign
  b.controller.sync(true, true)
  assert.equal(b.win._fbq, foreign)
  assert.equal(b.win.fbq, undefined)
  assert.equal(b.scripts.length, 0)
})

test('same-page cleanup/remount does not emit a duplicate PageView', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.loadScript()
  b.controller.deactivate()
  b.controller.sync(true, true)
  assert.equal(pageviews(b).length, 1)
  assert.equal(b.scripts.length, 1)
})

test('returning from a disallowed route is a new public page visit', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.loadScript()
  b.win.location.href = 'https://www.cafe-sativa.com/account'
  b.controller.sync(true, true)
  b.win.location.href = 'https://www.cafe-sativa.com/'
  b.controller.sync(true, true)
  assert.equal(pageviews(b).length, 2)
})

test('sensitive same-site and full-path cross-site referrers do not load Meta', () => {
  for (const referrer of ['https://www.cafe-sativa.com/account?session_id=private',
    'https://other.example/private/path', 'https://other.example/?email=test@example.com']) {
    const b = browser()
    b.doc.referrer = referrer
    b.controller.sync(true, true)
    assert.equal(b.scripts.length, 0)
  }
  assert.equal(pixel.isSafePixelReferrer('https://www.google.com/'), true)
  assert.equal(pixel.isSafePixelReferrer('https://www.cafe-sativa.com/events'), true)
})

test('URLs containing credentials or nonstandard ports are excluded', () => {
  for (const url of ['https://user:password@www.cafe-sativa.com/', 'https://www.cafe-sativa.com:444/']) {
    assert.equal(pixel.isSafePixelLocation(url), false)
    assert.equal(pixel.isSafePixelReferrer(url), false)
  }
})

test('an existing script with our ID fails closed', () => {
  const b = browser()
  b.doc.getElementById = () => ({})
  b.controller.sync(true, true)
  assert.equal(b.scripts.length, 0)
})

test('script failure does not emit an event and can retry after a fresh sync', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.scripts[0].onerror()
  assert.equal(b.calls.length, 0)
  assert.equal(b.scripts[0].removed, true)
  b.controller.sync(true, true)
  b.loadScript(1)
  assert.equal(pageviews(b).length, 1)
})

test('deactivation on unmount prevents pending script-load events', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.controller.deactivate()
  b.loadScript()
  assert.equal(b.calls.length, 0)
})

for (const path of ['/account', '/admin', '/auth/callback', '/hosts', '/lounge',
  '/events/private/watch', '/events?session_id=secret', '/?email=person@example.com',
  '/?fbclid=example', '/#access_token=secret']) {
  test(`private or unreviewed URL does not load the pixel: ${path}`, () => {
    const b = browser()
    b.win.location.href = `https://www.cafe-sativa.com${path}`
    b.controller.sync(true, true)
    assert.equal(b.scripts.length, 0)
  })
}

test('production hosts only; previews, lookalikes, HTTP and malformed URLs are denied', () => {
  for (const url of ['https://preview.vercel.app/', 'https://www.cafe-sativa.com.attacker.test/',
    'http://www.cafe-sativa.com/', 'not a URL']) assert.equal(pixel.isSafePixelLocation(url), false)
  assert.equal(pixel.isSafePixelLocation('https://cafe-sativa.com/'), true)
})

test('a sensitive navigation before script onload is rechecked without relying on React', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.win.location.href = 'https://www.cafe-sativa.com/auth/callback?code=secret'
  b.loadScript()
  assert.equal(b.calls.length, 0)
})

test('private navigation after load revokes instead of tracking', () => {
  const b = browser()
  b.controller.sync(true, true)
  b.loadScript()
  b.win.location.href = 'https://www.cafe-sativa.com/account'
  b.controller.sync(true, true)
  assert.deepEqual(b.calls.at(-1), ['consent', 'revoke'])
  assert.equal(pageviews(b).length, 1)
})

test('no noscript beacon, advanced matching or implicit opt-in appears in implementation', () => {
  const files = ['lib/analytics/meta-pixel.ts',
    'components/analytics/MetaPixel.tsx', 'app/layout.tsx']
  const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
  assert.doesNotMatch(source, /facebook\.com\/tr|<noscript|localStorage|sessionStorage/)
  const component = fs.readFileSync('components/analytics/MetaPixel.tsx', 'utf8')
  assert.match(component, /NEXT_PUBLIC_META_PIXEL_ENABLED === 'true'/)
  assert.doesNotMatch(component, /setMarketingConsent\(/)
  assert.match(component, /privacyConsent\.subscribe\(sync\)/)
})
