const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
function load(file, modules = {}) {
  const context = {exports: {}, Date, require(name) {
    assert.ok(name in modules, `Unexpected import ${name}`)
    return modules[name]
  }}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
  }).outputText, context)
  return context.exports
}
// Dependency-injected tests only: no database, credentials, network or provider.
const readonly = load('lib/content/character-promo-metricool-readonly.ts')
const connection = load('lib/content/character-promo-dispatch-connection.ts', {
  './character-promo-metricool-readonly': readonly,
})
const now = Date.parse('2026-11-09T12:00:00.000Z'), at = new Date(now).toISOString()
const ownerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
function fixture() {
  const f = {
    now, events: [], readCount: 0, ownerCount: 0, ownerValid: true,
    row: {provider: 'metricool', owner_id: ownerId, status: 'verified', brand_id: 5373515,
      user_id: 4174093, credential_ciphertext: 'fixture-ciphertext', last_error: null, updated_at: at},
    credentials: {access_token: 'fixture-access-token', token_type: 'Bearer', obtainedAt: at, expires_in: 3600},
  }
  f.deps = {
    now: () => f.now,
    db: {
      from(table) {
        assert.equal(table, 'cs_social_connections')
        let fields
        const q = {
          select(value) { fields = value.split(','); return q },
          eq(key, value) { assert.equal(key, 'provider'); assert.equal(value, 'metricool'); return q },
          async maybeSingle() {
            f.events.push('read'); f.readCount++
            await f.onRead?.(f.readCount, fields)
            const row = f.row && Object.fromEntries(fields.map(key => [key, f.row[key]]))
            return {data: row && structuredClone(row), error: f.readError || null}
          },
        }
        return q
      },
      auth: {admin: {async getUserById(id) {
        f.events.push('owner'); f.ownerCount++
        assert.equal(id, ownerId)
        await f.onOwner?.(f.ownerCount)
        return {data: {user: {id, app_metadata: {cafe_sativa_admin: f.ownerValid}}}, error: f.ownerError || null}
      }}},
    },
    decrypt(ciphertext) {
      f.events.push('decrypt'); assert.equal(ciphertext, 'fixture-ciphertext')
      return f.credentials
    },
    async openSession(token) {
      f.events.push('open'); assert.equal(token, 'fixture-access-token')
      await f.onOpen?.()
      return f.raw
    },
  }
  f.raw = {tools: ['never expose raw tools'], token: 'never expose raw fields', async call(name, args) {
    f.events.push(name)
    await f.onCall?.(name, args)
    return name === 'getBrandSettings' ? [{id: 5373515}] : name === 'getScheduledPosts' ? [] : {id: 42, uuid: 'mock-post'}
  }}
  f.open = () => connection.openCharacterPromoDispatchSession(f.deps)
  return f
}
const count = (f, name) => f.events.filter(value => value === name).length
const safeError = error => {
  assert.equal(error.name, 'PromoDispatchConnectionError')
  assert.equal(/private-secret|fixture-(access-token|ciphertext)|refresh-token|provider-body/.test(error.message), false)
  assert.equal(error.cause, undefined)
  return true
}

test('factory is dormant until invoked and reuses one authorized read-only session', async () => {
  const f = fixture()
  assert.equal(f.events.length, 0)
  const session = await f.open()
  assert.deepEqual(Object.keys(session).sort(), ['call', 'preflight'])
  assert.equal(Object.isFrozen(session), true)
  assert.equal(count(f, 'decrypt'), 1)
  assert.equal(count(f, 'open'), 1)
  assert.equal(count(f, 'getBrandSettings'), 1)
  assert.equal(count(f, 'createScheduledPost'), 0)
  assert.equal(f.events.some(value => /refresh|update|lock|download|sign|upload/i.test(value)), false)
})

test('lightweight preflight rereads pinned connection and current owner without decrypt/open/media', async () => {
  const f = fixture(), session = await f.open(), offset = f.events.length
  await session.preflight(); await session.preflight()
  assert.deepEqual(f.events.slice(offset), ['read', 'owner', 'read', 'owner'])
  assert.equal(count(f, 'decrypt'), 1); assert.equal(count(f, 'open'), 1)
})

test('only the three narrow provider operations are callable and raw session is not exposed', async () => {
  const f = fixture(), session = await f.open()
  await session.call('getBrandSettings', {})
  await session.call('getScheduledPosts', {brandId: '5373515'})
  assert.equal((await session.call('createScheduledPost', {blogId: '5373515'})).id, 42)
  await session.call('getScheduledPosts', {brandId: '5373515'})
  assert.equal(count(f, 'createScheduledPost'), 1)
  await assert.rejects(() => session.call('deleteScheduledPost', {}), error => error.code === 'metricool_operation_not_allowed')
  assert.equal(count(f, 'deleteScheduledPost'), 0)
  assert.equal(session.token, undefined); assert.equal(session.tools, undefined)
})

test('each call preflights immediately before and after the mock provider operation', async () => {
  const f = fixture(), session = await f.open(), offset = f.events.length
  await session.call('createScheduledPost', {})
  assert.deepEqual(f.events.slice(offset), ['read', 'owner', 'createScheduledPost', 'read', 'owner'])
})

test('concurrent create calls consume the only attempt before contacting the provider', async () => {
  const f = fixture(), session = await f.open()
  const outcomes = await Promise.allSettled([session.call('createScheduledPost', {}), session.call('createScheduledPost', {})])
  assert.equal(count(f, 'createScheduledPost'), 1)
  assert.equal(outcomes.some(result => result.status === 'rejected'), true)
  await assert.rejects(() => session.call('createScheduledPost', {}))
  assert.equal(count(f, 'createScheduledPost'), 1)
})

test('a second create is forbidden even after a successful first call', async () => {
  const f = fixture(), session = await f.open()
  await session.call('createScheduledPost', {})
  await assert.rejects(() => session.call('createScheduledPost', {}), error => error.code === 'metricool_operation_not_allowed')
  assert.equal(count(f, 'createScheduledPost'), 1)
})

test('uncertain provider create closes the session without retry or diagnostic leakage', async () => {
  const f = fixture(), session = await f.open()
  f.onCall = async name => { if (name === 'createScheduledPost') throw Error('provider-body private-secret') }
  await assert.rejects(() => session.call('createScheduledPost', {}), safeError)
  await assert.rejects(() => session.call('createScheduledPost', {}), safeError)
  assert.equal(count(f, 'createScheduledPost'), 1); assert.equal(count(f, 'open'), 1)
})

test('invalid, expired, near-expiry, future-issued and nonbearer credentials cannot open a session', async () => {
  const edits = [f => f.credentials.expires_in = 60, f => f.credentials.expires_in = 0,
    f => f.credentials.expires_in = Number.MAX_VALUE, f => f.credentials.expires_in = Infinity,
    f => f.credentials.obtainedAt = 'invalid', f => f.credentials.obtainedAt = new Date(now + 1000).toISOString(),
    f => f.credentials.token_type = 'Basic', f => delete f.credentials.access_token,
    f => f.credentials = null, f => f.now = NaN]
  for (const edit of edits) {
    const f = fixture(); edit(f)
    await assert.rejects(f.open, safeError)
    assert.equal(count(f, 'open'), 0)
  }
})

test('revoked or wrong connection and reconnect hold fail before opening', async () => {
  for (const edit of [f => f.row.status = 'revoked', f => f.row.brand_id = 1, f => f.row.user_id = 1,
    f => f.row.last_error = 'OAuth invalid_grant (HTTP 400)', f => f.row.last_error = 'OAuth invalid_client (HTTP 400)',
    f => f.ownerValid = false, f => f.ownerError = Error('private-secret')]) {
    const f = fixture(); edit(f)
    await assert.rejects(f.open, safeError); assert.equal(count(f, 'open'), 0)
  }
})

test('missing, malformed or unavailable pin fails before decrypt or opening', async () => {
  for (const edit of [f => f.row = null, f => delete f.row.updated_at, f => f.row.updated_at = 'invalid',
    f => f.row.provider = 'other', f => f.row.credential_ciphertext = '', f => f.row.owner_id = '',
    f => f.readError = Error('private-secret')]) {
    const f = fixture(); edit(f)
    await assert.rejects(f.open, safeError)
    assert.equal(count(f, 'decrypt'), 0); assert.equal(count(f, 'open'), 0)
  }
})

test('the exact original pin cannot drift before opening or during initial brand read', async () => {
  for (const phase of ['before_open', 'during_open', 'during_brand_read']) {
    const f = fixture()
    const change = () => { f.row.updated_at = '2026-11-09T12:00:00.000001Z' }
    if (phase === 'before_open') f.onRead = n => { if (n === 3) change() }
    if (phase === 'during_open') f.onOpen = change
    if (phase === 'during_brand_read') f.onCall = change
    await assert.rejects(f.open, error => error.code === 'metricool_connection_changed')
    assert.equal(count(f, 'open'), phase === 'before_open' ? 0 : 1)
    assert.equal(count(f, 'getBrandSettings'), phase === 'during_brand_read' ? 1 : 0)
  }
})

test('every pinned identity field rejects change before create, including exact bigint types', async () => {
  for (const [field, value] of [['provider', 'other'], ['owner_id', 'different-owner'], ['status', 'revoked'],
    ['brand_id', '5373515'], ['user_id', '4174093'], ['credential_ciphertext', 'rotated'],
    ['last_error', 'OAuth invalid_grant (HTTP 400)'], ['updated_at', '2026-11-09T12:00:00.000001Z']]) {
    const f = fixture(), session = await f.open()
    f.row[field] = value
    await assert.rejects(() => session.call('createScheduledPost', {}), safeError)
    assert.equal(count(f, 'createScheduledPost'), 0)
    assert.equal(count(f, 'decrypt'), 1); assert.equal(count(f, 'open'), 1)
  }
})

test('updated_at microsecond change detects an otherwise restored connection', async () => {
  const f = fixture(), session = await f.open()
  const original = {...f.row}
  f.row.status = 'revoked'
  f.row = {...original, updated_at: '2026-11-09T12:00:00.000001+00:00'}
  await assert.rejects(session.preflight, error => error.code === 'metricool_connection_changed')
  await assert.rejects(() => session.call('createScheduledPost', {}))
  assert.equal(count(f, 'createScheduledPost'), 0)
})

test('an observed revocation latches closed even if the complete connection is restored', async () => {
  const f = fixture(), session = await f.open(), original = {...f.row}
  f.row.status = 'revoked'
  await assert.rejects(session.preflight)
  f.row = original
  const offset = f.events.length
  await assert.rejects(session.preflight)
  await assert.rejects(() => session.call('createScheduledPost', {}))
  assert.equal(f.events.length, offset)
})

test('current administrator loss and owner lookup errors block create and latch closed', async () => {
  for (const mode of ['revoked', 'error']) {
    const f = fixture(), session = await f.open()
    if (mode === 'revoked') f.ownerValid = false
    else f.ownerError = Error('private-secret')
    await assert.rejects(() => session.call('createScheduledPost', {}), error => error.code === 'metricool_owner_unavailable')
    f.ownerValid = true; f.ownerError = null
    await assert.rejects(session.preflight)
    assert.equal(count(f, 'createScheduledPost'), 0)
  }
})

test('cached token expiry is checked without decrypting mutated credentials again', async () => {
  const f = fixture(); f.credentials.expires_in = 70
  const session = await f.open()
  f.credentials.expires_in = 3600; f.now += 10_000
  await assert.rejects(session.preflight, error => error.code === 'metricool_reconnect_required')
  assert.equal(count(f, 'decrypt'), 1); assert.equal(count(f, 'open'), 1)
})

test('one absolute 25-second budget starts when opening and never resets during preflight', async () => {
  const f = fixture()
  f.onRead = n => { if (n === 1) f.now += 120_000 }
  const session = await f.open()
  f.now += 24_999; await session.preflight()
  f.now += 1
  await assert.rejects(() => session.call('createScheduledPost', {}), error => error.code === 'metricool_session_expired')
  assert.equal(count(f, 'createScheduledPost'), 0); assert.equal(count(f, 'open'), 1)
})

test('opening and initial verification time consume the same session budget', async () => {
  for (const phase of ['open', 'call']) {
    const f = fixture()
    const advance = () => { f.now += 25_000 }
    if (phase === 'open') f.onOpen = advance
    else f.onCall = advance
    await assert.rejects(f.open, safeError)
    assert.equal(count(f, 'open'), 1); assert.equal(count(f, 'createScheduledPost'), 0)
  }
})

test('authorization or deadline changes during a provider call fail closed after the call', async () => {
  for (const mode of ['deadline', 'connection']) {
    const f = fixture(), session = await f.open()
    f.onCall = () => {
      if (mode === 'deadline') f.now += 25_000
      else f.row.credential_ciphertext = 'rotated'
    }
    await assert.rejects(() => session.call('createScheduledPost', {}), safeError)
    await assert.rejects(() => session.call('createScheduledPost', {}))
    assert.equal(count(f, 'createScheduledPost'), 1)
  }
})

test('thrown database, decrypt, session and owner diagnostics are sanitized with no retry', async () => {
  for (const phase of ['read', 'decrypt', 'open', 'owner']) {
    const f = fixture(), secret = () => { throw Error('private-secret fixture-access-token') }
    if (phase === 'read') f.onRead = secret
    if (phase === 'decrypt') f.deps.decrypt = secret
    if (phase === 'open') f.onOpen = secret
    if (phase === 'owner') f.onOwner = secret
    await assert.rejects(f.open, safeError)
    assert.ok(count(f, 'open') <= 1)
  }
})

test('malformed methods and argument objects never reach the provider', async () => {
  for (const [name, args] of [['refresh', {}], ['getBrandSettings', null], ['getScheduledPosts', []], ['createScheduledPost', 'bad']]) {
    const f = fixture(), session = await f.open(), offset = f.events.length
    await assert.rejects(() => session.call(name, args), error => error.code === 'metricool_operation_not_allowed')
    assert.equal(f.events.length, offset)
  }
})
