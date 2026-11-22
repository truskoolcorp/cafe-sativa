const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')
const vm = require('node:vm')

const read = path => stripTypeScriptTypes(readFileSync(`${__dirname}/../${path}`, 'utf8')
  .replace(/^import .*\n/gm, '').replace(/^export /gm, ''))
const code = read('lib/lounge-membership.ts') + '\n' + read('app/api/account/replays/route.ts') + '\nthis.GET = GET;'
const id = '64df4d43-2011-4b47-9ba6-96c0b5cc99da'
const record = {
  id, title: 'Synthetic Stage replay', description: null,
  storage_bucket: 'private-fixture', storage_path: 'fixture.mp4',
  status: 'published', approved_at: '2026-01-01T00:00:00Z', release_at: '2026-01-02T00:00:00Z',
}
const valid = { tier: 'vip', status: 'active', current_period_end: '2099-12-02T00:00:00Z' }
const person = { id: 'qa', app_metadata: {} }

async function exercise({ user = person, member = valid, replay = record, play = id, publicBucket = false } = {}) {
  let privileged = 0
  const signatures = []
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select() { return this }, eq() { return this }, async maybeSingle() { return { data: member } } }),
  }
  const admin = {
    from(table) {
      const filters = []
      let single = false
      let fields = ''
      return {
        select(s) { fields = s; return this },
        eq(k, v) { filters.push(row => row[k] === v); return this },
        not(k, op, v) { assert.equal(op, 'is'); filters.push(row => row[k] !== v); return this },
        lte(k, v) { filters.push(row => Date.parse(row[k]) <= Date.parse(v)); return this },
        order() { return this },
        limit() { return this },
        maybeSingle() { single = true; return this },
        then(resolve) {
          const rows = table === 'cs_vip_recordings' && filters.every(f => f(replay))
            ? [Object.fromEntries(fields.split(',').map(k => [k, replay[k]]))] : []
          resolve({ data: single ? rows[0] ?? null : rows })
        },
      }
    },
    storage: {
      getBucket: async () => ({ data: { public: publicBucket } }),
      from: bucket => ({ createSignedUrl: async (path, lifetime) => {
        signatures.push({ bucket, path, lifetime })
        return { data: { signedUrl: 'https://private.example/fixture-token' } }
      } }),
    },
  }
  const scope = {
    createClient: () => client,
    createAdminClient: () => { privileged++; return admin },
    NextResponse: { json: (body, options) => ({ body, headers: options.headers, status: options.status ?? 200 }) },
  }
  vm.runInNewContext(code, scope)
  const nextUrl = new URL('https://www.cafe-sativa.com/api/account/replays')
  if (play !== null) nextUrl.searchParams.set('play', play)
  const result = await scope.GET({ nextUrl })
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  return { result, privileged, signatures }
}

test('signed-out and anonymous sessions get no replay catalog or signed media URL', async () => {
  for (const user of [null, { ...person, is_anonymous: true }]) {
    const { result, privileged } = await exercise({ user })
    assert.equal(result.status, 401)
    assert.equal(privileged, 0)
  }
})

test('non-VIP and expired VIP cannot request playback, even with an exact recording ID', async () => {
  for (const member of [{ ...valid, tier: 'regular' }, { ...valid, current_period_end: '2000-01-01T00:00:00Z' }]) {
    const denied = await exercise({ member })
    assert.equal(denied.result.status, 403)
    assert.equal(denied.privileged, 0)
    assert.equal((await exercise({ member, play: null })).result.body.entitled, false)
  }
})

test('draft, not approved, scheduled, and public-bucket recordings never get signed', async () => {
  for (const change of [{ status: 'draft' }, { approved_at: null }, { release_at: '2099-01-02T00:00:00Z' }]) {
    const replay = { ...record, ...change }
    const playback = await exercise({ replay })
    assert.equal(playback.result.status, 404)
    assert.equal(playback.signatures.length, 0)
    assert.equal((await exercise({ replay, play: null })).result.body.items.length, 0)
  }
  const exposed = await exercise({ publicBucket: true })
  assert.equal(exposed.result.status, 503)
  assert.equal(exposed.signatures.length, 0)
})

test('eligible VIP gets a short-lived URL only for an approved, released private recording', async () => {
  const playback = await exercise()
  assert.equal(playback.result.status, 200)
  assert.equal(playback.result.body.expiresInSeconds, 120)
  assert.deepEqual(playback.signatures, [{ bucket: 'private-fixture', path: 'fixture.mp4', lifetime: 120 }])
  const listed = (await exercise({ play: null })).result.body.items[0]
  assert.equal(listed.id, id)
  assert.equal(listed.storage_path, undefined)
  assert.equal(listed.url, undefined)
})
