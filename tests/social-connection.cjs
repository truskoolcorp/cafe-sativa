const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm'), assert = require('node:assert/strict')
const code = ts.transpileModule(fs.readFileSync('lib/content/social-connection.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
let busy = false, admin = true, cas = true, refreshes = 0, operations = 0, sealed, patches = []
let storedCredentials = { clientId: 'owned-client', refresh_token: 'private-test-refresh' }
const connection = { owner_id: 'owner', credential_ciphertext: 'saved', lock_until: 'locked', dispatch_enabled: false }
let current = { credential_ciphertext: 'saved', last_error: null }, currentError = null
const db = {
  rpc: async name => { assert.equal(name, 'cs_claim_social_connection'); return { data: busy ? [] : [connection] } },
  auth: { admin: { getUserById: async id => { assert.equal(id, 'owner'); return { data: { user: { app_metadata: { cafe_sativa_admin: admin } } } } } } },
  from(table) {
    assert.equal(table, 'cs_social_connections')
    let patch, filters = []
    const q = {
      update(value) { patch = value; return q }, eq(key, value) { filters.push([key, value]); return q }, select() { return q },
      maybeSingle: async () => {
        // A status reread is distinct from a compare-and-swap update result.
        if (!patch) return { data: current, error: currentError }
        patches.push({ patch, filters })
        return { data: cas ? { provider: 'metricool' } : null, error: null }
      },
      then(resolve, reject) { patches.push({ patch, filters }); return Promise.resolve({ error: null }).then(resolve, reject) },
    }
    return q
  },
}
const ctx = {
  exports: {}, Date, URLSearchParams,
  require(name) {
    if (name === 'node:crypto') return require(name)
    if (name.endsWith('/admin')) return { createAdminClient: () => db }
    if (name.endsWith('/metricool-oauth')) return {
      METRICOOL_MCP: 'https://ai.metricool.com/mcp', unseal: () => storedCredentials,
      seal: obj => { sealed = obj; return 'encrypted' },
      providerJson: async (path, args) => {
        refreshes++
        assert.equal(path, '/oauth/token')
        assert.equal(args.get('grant_type'), 'refresh_token')
        assert.equal(args.get('client_id'), 'owned-client')
        return { access_token: 'private-test-access', token_type: 'Bearer', clientId: 'malicious-overwrite' }
      },
    }
    if (name.endsWith('/metricool-mcp')) return {
      metricoolSession: async token => { assert.equal(token, 'private-test-access'); return { tools: [], call: async () => ({}) } },
      verifiedMetricoolBrand: () => ({ label: 'Tru Skool' }),
    }
    if (name.endsWith('/social-contract')) return { verifySocialToolContract: () => {} }
    throw Error(name)
  },
}
vm.runInNewContext(code, ctx)
const run = () => ctx.exports.withSocialConnection(async ({ enabled }) => { operations++; assert.equal(enabled, false); return 'read-only' })
const assertLockReleased = () => assert.ok(patches.some(({ patch, filters }) => patch.lock_until === null && filters.some(([key, value]) => key === 'lock_until' && value === 'locked')))
;(async () => {
  busy = true
  await assert.rejects(run, /unavailable or busy/)
  assert.equal(refreshes, 0)
  busy = false
  for (const error of ['OAuth invalid_grant', 'OAuth invalid_client']) {
    current.last_error = error
    patches = []
    await assert.rejects(run, /reconnection required/)
    assert.equal(refreshes, 0)
    assert.equal(operations, 0)
    assertLockReleased()
  }
  current.last_error = null
  currentError = Error('Status unavailable')
  await assert.rejects(run, /status unavailable/)
  currentError = null
  current.credential_ciphertext = 'reauthorized'
  await assert.rejects(run, /connection changed/)
  assert.equal(refreshes, 0)
  assert.equal(operations, 0)
  current.credential_ciphertext = 'saved'
  admin = false
  patches = []
  await assert.rejects(run, /no longer/)
  assert.equal(refreshes, 0)
  assertLockReleased()
  admin = true
  cas = false
  await assert.rejects(run, /connection changed/)
  assert.equal(operations, 0)
  cas = true
  assert.equal(await run(), 'read-only')
  assert.equal(sealed.clientId, 'owned-client')
  assert.equal(sealed.refresh_token, 'private-test-refresh')
  assert.ok(patches.some(({ patch, filters }) => patch.credential_ciphertext === 'encrypted' && filters.some(([key, value]) => key === 'credential_ciphertext' && value === 'saved')))
  assert.ok(patches.some(({ patch, filters }) => patch.capabilities_verified === true && filters.some(([key, value]) => key === 'credential_ciphertext' && value === 'encrypted')))
  const before = refreshes
  storedCredentials = { ...storedCredentials, access_token: 'private-test-access', token_type: 'Bearer', expires_in: 3600, obtainedAt: new Date().toISOString() }
  assert.equal(await run(), 'read-only')
  assert.equal(refreshes, before)
  storedCredentials.obtainedAt = new Date(Date.now() - 7200000).toISOString()
  assert.equal(await run(), 'read-only')
  assert.equal(refreshes, before + 1)
  assert.equal(operations, 3)
  console.log('PASS: unexpired access reused; expired access refreshed; persisted reconnect/status guards; busy locks, trusted owner, compare-and-swap refresh, pinned public client and lock release')
})().catch(error => { console.error(error); process.exitCode = 1 })
