const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const context = { exports: {}, Request, Response, URL, TextDecoder, Uint8Array, Intl, Date }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/content/character-promo-dispatch-http.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, context)
const { createPromoDispatchHandler, PROMO_DISPATCH_MAX_BODY_BYTES } = context.exports
const url = 'https://www.cafe-sativa.com/api/admin/programming/character-promos/dispatch'
const origin = new URL(url).origin
const planId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const digest = 'a'.repeat(64)
const body = () => ({ planId, reviewedDigest: digest, explicitConfirmation: true, transmitApprovedVideo: true })
const receipt = () => ({ providerId: 'provider-post', providerUuid: 'provider-uuid', snapshotDigest: digest, videoSha256: 'b'.repeat(64), network: 'facebook', accountId: '146219355471397', brandId: '5373515', userId: '4174093', caption: 'The exact reviewed caption.', scheduledAt: '2026-12-01T12:00:00.000Z', timezone: 'America/New_York', state: 'scheduled' })
function request(value = body(), headers = {}, options = {}) {
  return new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value), ...options })
}
function fixture() {
  const calls = []
  const deps = {
    enabled: () => true,
    authorize: async () => { calls.push('authorize'); return true },
    dispatch: async value => { calls.push({ dispatch: value }); return { status: 'scheduled', publicationConfirmed: false, receipt: receipt() } },
  }
  return { deps, calls, handle: createPromoDispatchHandler(deps) }
}

test('disabled and failed flag evaluation stop before authentication or body reads for every method', async () => {
  for (const enabled of [() => false, () => { throw Error('private-flag-error') }]) {
    const f = fixture(); f.deps.enabled = enabled
    for (const method of ['POST', 'GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await f.handle(new Request(url, { method }))
      assert.equal(response.status, 503)
      assert.equal((await response.json()).code, 'dispatch_runtime_disabled')
    }
    assert.deepEqual(f.calls, [])
  }
})
test('enabled boundary is POST-only with no authentication for rejected methods', async () => {
  const f = fixture()
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await f.handle(new Request(url, { method }))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'POST')
  }
  assert.deepEqual(f.calls, [])
})
test('only exact same-origin JSON may reach authorization', async () => {
  for (const headers of [
    { origin: 'https://other.example' }, { origin: 'null' }, { origin: '' }, { origin: origin + '/' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' },
    { 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' },
    { 'content-type': 'application/json, text/plain' }, { 'content-type': 'application/json; charset=utf-16' },
  ]) {
    const f = fixture(), response = await f.handle(request(body(), headers))
    assert.ok([403, 415].includes(response.status))
    assert.deepEqual(f.calls, [])
  }
  const absent = request(); absent.headers.delete('origin')
  assert.equal((await fixture().handle(absent)).status, 403)
  const f = fixture()
  assert.equal((await f.handle(request(body(), { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' }))).status, 200)
})
test('unauthorized and failed authorization never read the body or call dispatch', async () => {
  for (const authorize of [async () => false, async () => { throw Error('private-auth-error') }]) {
    const f = fixture(); f.deps.authorize = authorize
    const req = request()
    Object.defineProperty(req, 'body', { get() { throw Error('Body must not be read') } })
    const response = await f.handle(req)
    assert.equal(response.status, 401)
    assert.equal(JSON.stringify(await response.json()).includes('private'), false)
    assert.deepEqual(f.calls, [])
  }
})
test('dispatch requires exactly four fields and both explicit true consent values', async () => {
  const cases = [null, [], 'string', {}, ...['planId', 'reviewedDigest', 'explicitConfirmation', 'transmitApprovedVideo'].map(key => {
    const value = body(); delete value[key]; return value
  }), ...[false, 'true', 1, null].flatMap(value => [{ ...body(), explicitConfirmation: value }, { ...body(), transmitApprovedVideo: value }]),
  { ...body(), planId: 'invalid' }, { ...body(), planId: {} }, { ...body(), reviewedDigest: 'A'.repeat(64) },
  { ...body(), reviewedDigest: 'g'.repeat(64) }, { ...body(), reviewedDigest: digest + 'a' },
  ...['actor', 'accountId', 'network', 'mediaUrl', 'videoPath', 'snapshot', 'retry', 'action'].map(key => ({ ...body(), [key]: 'untrusted' }))]
  for (const value of cases) {
    const f = fixture(), response = await f.handle(request(value))
    assert.equal(response.status, 400, JSON.stringify(value))
    assert.deepEqual(f.calls, ['authorize'])
  }
})
test('actual streamed bytes are bounded without trusting content-length, including UTF-8 bytes', async () => {
  for (const contentLength of [undefined, '1']) {
    let cancelled = false
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(PROMO_DISPATCH_MAX_BODY_BYTES))
        controller.enqueue(new Uint8Array([32]))
      },
      cancel() { cancelled = true },
    })
    const f = fixture(), headers = { origin, 'content-type': 'application/json' }
    if (contentLength !== undefined) headers['content-length'] = contentLength
    const response = await f.handle(new Request(url, { method: 'POST', headers, body: stream, duplex: 'half' }))
    assert.equal(response.status, 413)
    assert.equal(cancelled, true)
    assert.deepEqual(f.calls, ['authorize'])
  }
  const f = fixture()
  assert.equal((await f.handle(request({ ...body(), extra: '🍃'.repeat(1200) }))).status, 413)
  assert.deepEqual(f.calls, ['authorize'])
})
test('invalid size declarations, lying lengths, malformed JSON and invalid UTF-8 fail before dispatch', async () => {
  for (const length of ['-1', '1.5', 'not-a-length', String(PROMO_DISPATCH_MAX_BODY_BYTES + 1), '9007199254740992']) {
    const f = fixture()
    assert.equal((await f.handle(request(body(), { 'content-length': length }))).status, 413)
    assert.deepEqual(f.calls, ['authorize'])
  }
  for (const req of [request(body(), { 'content-length': '1' }), request(body(), {}, { body: '{' }), request(body(), {}, { body: new Uint8Array([0xff]) }), request(body(), {}, { body: null })]) {
    const f = fixture()
    assert.equal((await f.handle(req)).status, 400)
    assert.deepEqual(f.calls, ['authorize'])
  }
  const f = fixture()
  assert.equal((await f.handle(request(body(), { 'content-length': String(Buffer.byteLength(JSON.stringify(body()))) }))).status, 200)
})
test('broken stream returns sanitized input failure without dispatch', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(Error('private-stream-failure')) } })
  const f = fixture(), response = await f.handle(new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: stream, duplex: 'half' }))
  assert.equal(response.status, 400)
  assert.equal(JSON.stringify(await response.json()).includes('private-stream'), false)
  assert.deepEqual(f.calls, ['authorize'])
})
test('one accepted request invokes exactly one dispatch and returns only a sanitized scheduled receipt', async () => {
  const f = fixture(), original = f.deps.dispatch
  f.deps.dispatch = async value => ({ ...await original(value), publicUrl: 'https://private.example/?token=secret', credential: 'secret', receipt: { ...receipt(), signedUrl: 'https://private.example/?token=secret' } })
  const response = await f.handle(request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), ['authorize', { dispatch: body() }])
  assert.deepEqual(await response.json(), { status: 'scheduled', publicationConfirmed: false, receipt: receipt() })
})
test('all uncertain, malformed and thrown dispatch outcomes forbid retry and hide provider details', async () => {
  const bad = [null, [], {}, { status: 'published', publicUrl: 'secret' }, { status: 'scheduled', publicationConfirmed: true, receipt: receipt() },
    { status: 'scheduled', publicationConfirmed: false, receipt: { ...receipt(), snapshotDigest: 'c'.repeat(64) } },
    { status: 'scheduled', publicationConfirmed: false, receipt: { ...receipt(), providerId: 'https://secret.example' } },
    { status: 'scheduled', publicationConfirmed: false, receipt: { ...receipt(), timezone: 'invalid' } },
    { status: 'submission_unknown', error: 'private-secret' }]
  for (const value of bad) {
    const f = fixture(); let dispatches = 0
    f.deps.dispatch = async () => { dispatches++; return value }
    const response = await f.handle(request()), result = await response.json()
    assert.equal(response.status, 503)
    assert.equal(result.status, 'submission_unknown')
    assert.equal(result.publicationConfirmed, false)
    assert.match(result.error, /Do not retry/)
    assert.equal(JSON.stringify(result).includes('secret'), false)
    assert.equal(dispatches, 1)
  }
  const f = fixture(); let dispatches = 0
  f.deps.dispatch = async () => { dispatches++; throw Error('secret-token') }
  const response = await f.handle(request())
  assert.equal(response.status, 503)
  assert.equal(dispatches, 1)
  assert.equal(JSON.stringify(await response.json()).includes('secret'), false)
})
test('blocked, disabled and existing claim statuses do not return arbitrary server reasons', async () => {
  for (const [status, code] of [['blocked', 409], ['already_claimed_or_stale', 409], ['disabled', 503]]) {
    const f = fixture()
    f.deps.dispatch = async () => ({ status, reason: 'private-token', publicationConfirmed: true })
    const response = await f.handle(request()), result = await response.json()
    assert.equal(response.status, code)
    assert.equal(result.status, status)
    assert.equal(result.publicationConfirmed, false)
    assert.equal(JSON.stringify(result).includes('private-token'), false)
  }
})
