const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(name, imports = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(`lib/events/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(code, { exports, require: name => imports[name], Request, Response, Headers, URL, AbortSignal, Date })
  return exports
}
const windowState = load('ahnika-premiere-window', { './stage-lobby': load('stage-lobby') })
const { serveAhnikaPremiereMedia } = load('ahnika-premiere-media', { './ahnika-premiere-window': windowState })
const origin = 'https://ekaukffotzujkkpdvpgj.supabase.co'
const relayUrl = origin + '/functions/v1/cafe-sativa-stage-canary'
const storageUrl = origin + '/storage/v1/object/sign/cafe-sativa-content/Ahnika_Merlot_Cafe_Sativa_Stage_Premiere_Cut.mp4?token=private-fixture'
const clock = Date.parse(windowState.AHNIKA_PREMIERE_START)

function fixture(options = {}) {
  const fetches = []
  let queries = 0
  const dependencies = {
    relayUrl, key: 'authorized-fixture',
    now: () => options.now ?? clock,
    canonical: async () => { queries++; return options.canonical ?? true },
    fetch: async (url, init) => {
      fetches.push({ url: url.href, init })
      if (fetches.length === 1) return Response.json({ url: options.url ?? storageUrl })
      const partial = init.headers.Range
      return new Response('abc', {
        status: options.status ?? (partial ? 206 : 200),
        headers: { 'Content-Length': '3', 'Content-Range': partial ? 'bytes 0-2/99' : '', 'Set-Cookie': 'internal=hidden' },
      })
    },
  }
  return { fetches, queries: () => queries, serve: range =>
    serveAhnikaPremiereMedia(new Request('https://www.cafe-sativa.com/api/events/ahnika-premiere', { headers: range ? { range } : {} }), dependencies) }
}

test('before kickoff and from the exact end onward: no signer, media, or canonical lookup', async () => {
  for (const now of [clock - 1, windowState.AHNIKA_PREMIERE_END, windowState.AHNIKA_PREMIERE_END + 1000]) {
    const f = fixture({ now })
    const response = await f.serve('bytes=0-2')
    assert.equal(response.status, 404)
    assert.equal(f.fetches.length, 0)
    assert.equal(f.queries(), 0)
    assert.match(response.headers.get('Cache-Control'), /no-store/)
  }
})

test('approved premiere forwards a single media range without leaking storage credentials', async () => {
  const f = fixture()
  const r = await f.serve('bytes=0-2')
  assert.equal(r.status, 206)
  assert.equal(await r.text(), 'abc')
  assert.equal(r.headers.get('content-range'), 'bytes 0-2/99')
  assert.equal(r.headers.get('location'), null)
  assert.equal(r.headers.get('set-cookie'), null)
  assert.equal(f.fetches[0].init.headers['x-canary-key'], 'authorized-fixture')
  assert.equal(f.fetches[1].init.headers.Range, 'bytes=0-2')
  assert.equal(f.fetches[1].init.headers['x-canary-key'], undefined)
})

test('malformed range, noncanonical event, untrusted signer location and bad range response fail closed', async () => {
  const malformed = fixture()
  assert.equal((await malformed.serve('bytes=0-1,4-5')).status, 416)
  assert.equal(malformed.fetches.length, 0)
  const canceled = fixture({ canonical: false })
  assert.equal((await canceled.serve()).status, 404)
  assert.equal(canceled.fetches.length, 0)
  const wrongSource = fixture({ url: 'https://example.com/other.mp4?token=wrong' })
  assert.equal((await wrongSource.serve()).status, 503)
  assert.equal(wrongSource.fetches.length, 1)
  assert.equal((await fixture({ status: 200 }).serve('bytes=0-2')).status, 503)
})
