const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const candidateContext = { exports: {} }
vm.runInNewContext(compile('lib/content/reference-candidates.ts'), candidateContext)
const original = candidateContext.exports.REFERENCE_CANDIDATES.find(candidate => candidate.subject === 'stage')
assert.ok(original && original.kind === 'venue' && original.path.startsWith('/references/'))
// Route unit test: deterministic downloaded bytes replace the external static image.
// Keep the registry's fixed path/identity, and use a real SHA256 of the fixture bytes.
const reviewedBytes = Buffer.from('reviewed stage image fixture')
const candidate = { ...original, sha256: crypto.createHash('sha256').update(reviewedBytes).digest('hex') }
let authenticated = false, trustedAdmin = true, exists = false, changed = false
let registryError = null, sourceAvailable = true, fetches = 0, uploads = [], inserted = []
const db = {
  from(table) {
    assert.equal(table, 'cs_canonical_assets')
    return {
      select() { return this }, eq() { return this },
      maybeSingle: async () => ({ data: exists ? { id: 'existing' } : null, error: registryError }),
      insert(row) {
        inserted.push(row)
        return { select() { return this }, single: async () => ({ data: { id: 'new' }, error: null }) }
      },
    }
  },
  storage: { from(bucket) {
    assert.equal(bucket, 'cafe-sativa-canon')
    return {
      upload: async (path, bytes, options) => { uploads.push({ path, bytes, options }); return { error: null } },
      getPublicUrl: () => ({ data: { publicUrl: 'https://store.example/ref' } }),
    }
  } },
}
const context = {
  exports: {}, Buffer, AbortSignal, Date,
  fetch: async (url, options) => {
    fetches++
    assert.equal(url, `https://www.cafe-sativa.com${original.path}`)
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    const bytes = changed ? Buffer.from('changed image fixture') : reviewedBytes
    return {
      ok: sourceAvailable,
      headers: { get: () => original.path.endsWith('.png') ? 'image/png' : original.path.endsWith('.jpg') ? 'image/jpeg' : 'image/webp' },
      body: { getReader() { let done = false; return { read: async () => done ? { done: true } : (done = true, { done: false, value: bytes }) } } },
    }
  },
  require(name) {
    if (name === 'node:crypto') return crypto
    if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options.status }) } }
    if (name.endsWith('/auth')) return { isContentAdmin: async () => authenticated }
    if (name.endsWith('/server')) return { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner', app_metadata: { cafe_sativa_admin: trustedAdmin } } } }) } }) }
    if (name.endsWith('/admin')) return { createAdminClient: () => db }
    if (name.endsWith('/policy')) return { approvedAsset: () => true }
    if (name.endsWith('/program-readiness')) return { programReferenceStatus: () => [] }
    if (name.endsWith('/glyph-live')) return { liveGlyphCharacters: async () => ({ live: true, characters: [] }) }
    if (name.endsWith('/glyph-characters')) return { GLYPH_CHARACTER_SNAPSHOT: { characters: [] } }
    if (name.endsWith('/reference-candidates')) return { REFERENCE_CANDIDATES: [candidate] }
    throw Error(name)
  },
}
vm.runInNewContext(compile('app/api/content/references/route.ts'), context)
const post = (body, origin = 'https://www.cafe-sativa.com') => context.exports.POST({
  nextUrl: { origin: 'https://www.cafe-sativa.com' }, headers: { get: () => origin }, json: async () => body,
})
;(async () => {
  assert.equal((await post({})).status, 401)
  authenticated = true
  assert.equal((await post({ key: 'https://unapproved.example/image.png' })).status, 400)
  const body = { key: candidate.key, expectedSha: candidate.sha256, confirmIdentity: true, confirmLayout: true }
  assert.equal((await post(body)).status, 400)
  body.confirmEmptyRoom = true
  assert.equal((await post(body, 'https://other.example')).status, 403)
  assert.equal((await post({ ...body, expectedSha: '0'.repeat(64) })).status, 400)
  trustedAdmin = false
  assert.equal((await post(body)).status, 401)
  trustedAdmin = true
  exists = true
  assert.equal((await post(body)).status, 409)
  exists = false
  registryError = Error('Registry unavailable')
  assert.equal((await post(body)).status, 503)
  registryError = null
  assert.equal(fetches, 0)
  changed = true
  assert.equal((await post(body)).status, 409)
  changed = false
  sourceAvailable = false
  assert.equal((await post(body)).status, 409)
  assert.equal(uploads.length, 0)
  assert.equal(inserted.length, 0)
  sourceAvailable = true
  assert.equal((await post(body)).status, 200)
  assert.equal(fetches, 3)
  assert.equal(uploads.length, 1)
  assert.equal(inserted.length, 1)
  assert.deepEqual(uploads[0].bytes, reviewedBytes)
  assert.equal(uploads[0].options.upsert, false)
  assert.ok(uploads[0].path.includes(candidate.sha256))
  assert.equal(inserted[0].sha256, candidate.sha256)
  assert.equal(inserted[0].approved_by, 'owner')
  assert.equal(inserted[0].kind, 'venue')
  assert.equal(inserted[0].subject, 'stage')
  assert.equal(inserted[0].url, 'https://store.example/ref')
  assert.equal(inserted[0].active, true)
  console.log('PASS: auth/origin/explicit review gates; existing master preserved; missing/changed source rejected; exact fixture bytes registered without public assets or network')
})().catch(error => { console.error(error); process.exitCode = 1 })
