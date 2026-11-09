const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const timeModule={exports:{},Date,Intl};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/content/character-promo-dispatch-time.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText,timeModule)
const planId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', digest = 'd'.repeat(64)
function fixture() {
  return { enabled: true, reviewedDigest: digest, snapshot: {
    version: 1, planId, promoId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', characterId: 'keith', draftRevision: '2026-11-09T12:00:00.000Z',
    script: 'Exact script', visualBrief: 'Exact brief', durationSeconds: 20, audioPath: null,
    videoPath: 'private/path/must-not-appear.mp4', videoSha256: 'a'.repeat(64), videoBytes: 12345,
    qa: [], canon: { revisionSha256: 'b'.repeat(64), assetId: 'asset', portraitSha256: 'c'.repeat(64), voiceId: 'voice', rightsStatus: 'approved', voiceStatus: 'canonical', productionReady: true },
    approvals: { voice: '2026-11-09T12:00:00.000Z', video: '2026-11-09T12:00:00.000Z', publication: '2026-11-09T12:00:00.000Z' },
    caption: 'An exact private invitation.', scheduledAt: '2026-12-01T12:00:00.000Z', network: 'facebook', accountId: '146219355471397', brandId: '5373515', userId: '4174093', timezone: 'America/New_York',
  } }
}
function scheduled(props) {
  const s = props.snapshot
  return { status: 'scheduled', publicationConfirmed: false, receipt: {
    providerId: 'post', providerUuid: 'uuid', snapshotDigest: props.reviewedDigest, videoSha256: s.videoSha256,
    network: s.network, accountId: s.accountId, brandId: s.brandId, userId: s.userId,
    caption: s.caption, scheduledAt: s.scheduledAt, timezone: s.timezone, state: 'scheduled',
  } }
}
function harness(props = fixture()) {
  const slots = [], effects = [], cleanups = [], calls = []
  let cursor = 0, tree, pending
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useEffect(effect) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(effect) } },
  }
  const jsx = (type, props) => ({ type, props: props || {} })
  const context = { exports: {}, Date, Intl, JSON, fetch: async (url, options) => {
    calls.push({ url, options })
    return new Promise((resolve, reject) => { pending = { resolve, reject } })
  }, require: name => {
    if (name === '@/lib/content/character-promo-dispatch-time') return timeModule.exports
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    throw Error('Unexpected import: ' + name)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/admin/CharacterPromoDispatchConfirmation.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
  }).outputText, context)
  const h = {
    calls, get pending() { return pending },
    render(next = props) { props = next; cursor = 0; tree = context.exports.default(props); while (effects.length) cleanups.push(effects.shift()()); return tree },
    nodes(type) { const out = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (node.type === type) out.push(node); walk(node.props?.children) } walk(tree); return out },
    text() { const values = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (typeof node === 'string' || typeof node === 'number') return values.push(String(node)); if (node && typeof node === 'object') walk(node.props?.children) } walk(tree); return values.join(' ') },
    checkbox() { return h.nodes('input')[0] }, button() { return h.nodes('button')[0] },
    consent() { h.checkbox().props.onChange({ target: { checked: true } }); h.render() },
    async flush() { await new Promise(resolve => setImmediate(resolve)); h.render() },
    unmount() { cleanups.forEach(cleanup => cleanup?.()) },
  }
  h.render()
  return h
}

test('default-disabled panel and unchecked separate consent never fetch on mount or prop changes', () => {
  const props = fixture(); delete props.enabled
  const h = harness(props)
  assert.equal(h.checkbox().props.checked, false)
  assert.equal(h.checkbox().props.disabled, true)
  assert.equal(h.button().props.disabled, true)
  h.consent(); h.button().props.onClick()
  h.render({ ...props, enabled: true })
  assert.equal(h.checkbox().props.checked, false)
  assert.equal(h.button().props.disabled, true)
  assert.equal(h.calls.length, 0)
})
test('panel displays exact private SHA, bytes, named destination, caption, time and explicit Metricool consent without media URLs', () => {
  const props = fixture(), h = harness(props), text = h.text()
  for (const value of [props.snapshot.videoSha256, '12345', 'Facebook', props.snapshot.accountId, props.snapshot.caption, props.snapshot.scheduledAt, props.snapshot.timezone, digest, 'to Metricool', 'private MP4', 'not proof of publication']) assert.ok(text.includes(value), value)
  assert.equal(text.includes(props.snapshot.videoPath), false)
  assert.equal(h.nodes('video').length, 0)
  assert.equal(h.nodes('a').length, 0)
  assert.equal(h.checkbox().props.checked, false)
  assert.equal(h.button().props.disabled, true)
})
test('Threads consent names the specific Threads account rather than Facebook', () => {
  const props = fixture(); props.snapshot.network = 'threads'; props.snapshot.accountId = 'truskoolcorp'
  const h = harness(props)
  assert.match(h.text(), /Threads.*truskoolcorp/)
  assert.equal(h.text().includes('Facebook'), false)
})
test('invalid displayed identity, digest or size blocks transmission even with enabled prop', () => {
  for (const mutate of [p => p.reviewedDigest = 'bad', p => p.snapshot.planId = 'bad', p => p.snapshot.videoSha256 = 'bad', p => p.snapshot.videoBytes = 0, p => p.snapshot.videoBytes = 35 * 1024 * 1024 + 1, p => p.snapshot.network = 'instagram', p => p.snapshot.caption = '', p => p.snapshot.scheduledAt = 'bad']) {
    const p = fixture(); mutate(p); const h = harness(p)
    h.consent(); h.button().props.onClick()
    assert.equal(h.button().props.disabled, true)
    assert.equal(h.calls.length, 0)
  }
})
test('a synchronous guard allows exactly one narrow POST despite repeated clicks before rerender', async () => {
  const h = harness(); h.consent()
  assert.equal(h.button().props.disabled, false)
  const click = h.button().props.onClick
  click(); click(); click()
  assert.equal(h.calls.length, 1)
  const { url, options } = h.calls[0]
  assert.equal(url, '/api/admin/programming/character-promos/dispatch')
  assert.equal(options.method, 'POST')
  assert.equal(options.mode, 'same-origin')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.redirect, 'error')
  assert.deepEqual(JSON.parse(options.body), { planId, reviewedDigest: digest, explicitConfirmation: true, transmitApprovedVideo: true })
  h.render()
  assert.equal(h.button().props.disabled, true)
  assert.equal(h.checkbox().props.checked, false)
  h.pending.reject(Error('private-provider-error')); await h.flush()
  h.consent(); click(); h.button().props.onClick()
  assert.equal(h.calls.length, 1)
  assert.match(h.text(), /Manual reconciliation/)
  assert.equal(h.text().includes('private-provider-error'), false)
})
test('consent cannot survive reviewed-field changes, restored old props or stale handlers', () => {
  for (const change of [p => p.reviewedDigest = 'e'.repeat(64), p => p.snapshot.caption += ' changed', p => p.snapshot.videoBytes++, p => p.snapshot.videoSha256 = 'f'.repeat(64), p => p.snapshot.scheduledAt = '2026-12-02T12:00:00.000Z', p => p.snapshot.accountId = 'changed', p => p.enabled = false]) {
    const original = fixture(), h = harness(original); h.consent()
    const oldClick = h.button().props.onClick, oldChange = h.checkbox().props.onChange
    const next = structuredClone(original); change(next); h.render(next)
    assert.equal(h.checkbox().props.checked, false)
    oldClick(); oldChange({ target: { checked: true } })
    assert.equal(h.calls.length, 0)
    h.render(original)
    assert.equal(h.checkbox().props.checked, false)
    assert.equal(h.button().props.disabled, true)
    oldClick()
    assert.equal(h.calls.length, 0)
  }
})
test('every rejected, ambiguous or malformed result locks the panel without retry or raw errors', async () => {
  for (const outcome of [
    { ok: false, json: async () => ({ error: 'secret-error' }) },
    { ok: true, json: async () => { throw Error('private-json-error') } },
    ...[null, {}, { status: 'submission_unknown' }, { status: 'blocked' }, { status: 'disabled' }, { status: 'already_claimed_or_stale' }, { status: 'published', publicUrl: 'https://private.example' }].map(value => ({ ok: true, json: async () => value })),
  ]) {
    const h = harness(); h.consent(); h.button().props.onClick()
    h.pending.resolve(outcome); await h.flush()
    assert.equal(h.button().props.disabled, true)
    assert.match(h.text(), /Do not retry, including after a reload/)
    assert.equal(h.text().includes('secret-error'), false)
    assert.equal(h.text().includes('private-json-error'), false)
    assert.equal(h.text().includes('https://'), false)
    h.button().props.onClick(); assert.equal(h.calls.length, 1)
  }
})
test('scheduled is displayed only for a receipt matching every exact review field and never claims publication', async () => {
  const props = fixture(), h = harness(props)
  h.consent(); h.button().props.onClick()
  h.pending.resolve({ ok: true, json: async () => scheduled(props) }); await h.flush()
  assert.match(h.text(), /Scheduled\. The exact scheduling receipt was verified/)
  assert.match(h.text(), /Publication is not confirmed/)
  assert.equal(h.button().props.disabled, true)
  h.button().props.onClick(); assert.equal(h.calls.length, 1)
  for (const field of ['providerId', 'providerUuid', 'snapshotDigest', 'videoSha256', 'network', 'accountId', 'brandId', 'userId', 'caption', 'scheduledAt', 'timezone', 'state']) {
    const a = harness(props), result = scheduled(props)
    result.receipt[field] = field === 'providerId' || field === 'providerUuid' ? '' : 'mismatch'
    a.consent(); a.button().props.onClick()
    a.pending.resolve({ ok: true, json: async () => result }); await a.flush()
    assert.match(a.text(), /Manual reconciliation/, field)
    assert.equal(a.text().includes('Scheduled. The exact'), false)
  }
  const a = harness(props), result = scheduled(props); result.publicationConfirmed = true
  a.consent(); a.button().props.onClick(); a.pending.resolve({ ok: true, json: async () => result }); await a.flush()
  assert.match(a.text(), /Manual reconciliation/)
})
test('in-flight prop changes retain the attempted snapshot and cannot attribute its receipt to another plan', async () => {
  const original = fixture(), h = harness(original); h.consent(); h.button().props.onClick()
  const changed = structuredClone(original)
  changed.snapshot.caption = 'A different caption that was never submitted.'
  changed.snapshot.planId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  changed.reviewedDigest = 'e'.repeat(64)
  h.render(changed)
  assert.ok(h.text().includes(original.snapshot.caption))
  assert.equal(h.text().includes(changed.snapshot.caption), false)
  h.pending.resolve({ ok: true, json: async () => scheduled(original) }); await h.flush()
  assert.match(h.text(), /Scheduled\. The exact/)
  assert.equal(h.button().props.disabled, true)
  assert.equal(h.calls.length, 1)
})
test('unmount does not retry or allow a retained click handler to submit', async () => {
  const h = harness(); h.consent(); const click = h.button().props.onClick
  h.unmount(); click(); assert.equal(h.calls.length, 0)
  const active = harness(); active.consent(); active.button().props.onClick(); active.unmount()
  active.pending.reject(Error('disconnected')); await active.flush()
  active.button().props.onClick(); assert.equal(active.calls.length, 1)
})
test('fractional-second approved time remains displayed unchanged and cannot grant dispatch consent',()=>{const props=fixture();props.snapshot.scheduledAt='2026-12-01T12:00:00.123Z';const h=harness(props);assert.equal(h.checkbox().props.disabled,true);assert.equal(h.button().props.disabled,true);assert.match(h.text(),/Explicitly reauthor/);assert.ok(h.text().includes('2026-12-01T12:00:00.123Z'));h.consent();h.button().props.onClick();assert.equal(h.calls.length,0)})

test('both Chicago fall-back instants are blocked with explicit different-time instruction',()=>{for(const scheduledAt of ['2027-11-07T06:30:00.000Z','2027-11-07T07:30:00.000Z']){const props=fixture();props.snapshot.scheduledAt=scheduledAt;props.snapshot.timezone='America/Chicago';const h=harness(props);assert.equal(h.button().props.disabled,true);assert.match(h.text(),/local time repeats/);assert.ok(h.text().includes(scheduledAt));h.consent();h.button().props.onClick();assert.equal(h.calls.length,0)}})
