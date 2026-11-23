const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')

function load(path, deps = {}) {
  const publicNames = []
  const src = readFileSync(path, 'utf8')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+'([^']+)'/gm, (_, bindings, name) =>
      'const { ' + bindings.split(',').map(binding => binding.trim()).filter(binding => !binding.startsWith('type ')).join(', ') +
      ' } = deps[' + JSON.stringify(name) + ']')
    .replace(/^export\s+(const|function|async function)\s+(\w+)/gm, (_, kind, name) => {
      publicNames.push(name)
      return kind + ' ' + name
    })
  const context = { exports: {}, deps, Date, AbortSignal, Headers, Request, Response, URL }
  runInNewContext(stripTypeScriptTypes(src + '\nObject.assign(exports, { ' + publicNames.join(', ') + ' })'), context)
  return context.exports
}

const lobby = load('lib/events/stage-lobby.ts')
const premiere = load('lib/events/ahnika-premiere-window.ts', { './stage-lobby': lobby })
const rehearsal = load('lib/events/private-stage-rehearsal.ts', { './stage-lobby': lobby, './ahnika-premiere-window': premiere })
const { privateDressMedia, isDressAssetName, privateDressAssetWindow, servePrivateDressAsset } =
  load('lib/events/private-dress-media.ts', { './private-stage-rehearsal': rehearsal })
const env = { VERCEL_ENV: 'production', STAGE_PRIVATE_REHEARSAL_ENABLED: 'true', STAGE_PRIVATE_DRESS_KICKOFF: '2026-11-24T14:00:00Z' }
const slot = rehearsal.privateStagePlaybackSlot(env)
const fixture = { intro: { sha256: 'a'.repeat(64), bytes: 1024 }, captions: { sha256: 'b'.repeat(64), bytes: 128 },
  reveal: { sha256: 'c'.repeat(64), bytes: 512 }, performance: { sha256: 'd'.repeat(64), bytes: 4096 } }
const ready = privateDressMedia(JSON.stringify(fixture))
const validExpiry = '2026-11-24T14:20:00Z'

test('release requires all four separate digest-addressed objects; no URLs or partial packages', () => {
  assert.equal(isDressAssetName('performance'), true)
  assert.equal(isDressAssetName('__proto__'), false)
  assert.equal(isDressAssetName('intro.mp4'), false)
  assert.equal(ready.captions.object, 'stage-rehearsal/2026-11-24/' + fixture.captions.sha256 + '.en.vtt')
  for (const body of [undefined, '{}', JSON.stringify({ ...fixture, captions: null }),
    JSON.stringify({ ...fixture, performance: fixture.intro }),
    JSON.stringify({ ...fixture, intro: { ...fixture.intro, bytes: 21 * 1024 * 1024 } }),
    JSON.stringify({ ...fixture, performance: { ...fixture.performance, bytes: 40_000_001 } }),
    JSON.stringify({ ...fixture, intro: { url: 'https://evil.invalid', bytes: 100 } }),
    JSON.stringify({ ...fixture, performance: { bytes: 4096, sha256: '../unsafe' } })]) {
    assert.equal(privateDressMedia(body), null)
  }
})

test('intro and captions stop exactly when the performance and reveal unlock', () => {
  for (const name of ['intro', 'captions']) {
    assert.equal(privateDressAssetWindow(slot, name, slot.dress.intro - 1), false)
    assert.equal(privateDressAssetWindow(slot, name, slot.dress.intro), true)
    assert.equal(privateDressAssetWindow(slot, name, slot.start), false)
  }
  for (const name of ['performance', 'reveal']) {
    assert.equal(privateDressAssetWindow(slot, name, slot.start - 1), false)
    assert.equal(privateDressAssetWindow(slot, name, slot.start), true)
    assert.equal(privateDressAssetWindow(slot, name, slot.end), false)
  }
  assert.equal(privateDressAssetWindow({ ...slot, dress: null }, 'performance', slot.start), false)
  assert.equal(premiere.AHNIKA_PREMIERE_START, '2026-12-01T06:00:00.000Z')
})

test('early, expired, uninvited, multi-range and cutoff requests do not reach storage', async () => {
  for (const [clock, expiry, range, expected, inviteCalls] of [
    [slot.start - 1, validExpiry, 'bytes=0-0', 404, 0],
    [slot.end, validExpiry, 'bytes=0-0', 404, 0],
    [slot.start, null, 'bytes=0-0', 404, 1],
    [slot.start, '2026-11-24T14:16:00Z', 'bytes=0-0', 404, 1],
    [slot.start, validExpiry, 'bytes=0-0,2-3', 416, 1],
    [slot.start, validExpiry, 'bytes=-0', 416, 1],
  ]) {
    let invites = 0, signatures = 0, fetches = 0
    const response = await servePrivateDressAsset(new Request('https://stage.invalid', { headers: { range } }), slot, 'performance', ready.performance, {
      now: () => clock,
      invitation: async () => { invites++; return expiry },
      sign: async () => { signatures++; return null },
      fetch: async () => { fetches++; throw Error('unexpected fetch') },
    })
    assert.equal(response.status, expected)
    assert.deepEqual([invites, signatures, fetches], [inviteCalls, 0, 0])
  }
})

test('serves only the correct immutable range and never exposes the signed link', async () => {
  const request = new Request('https://stage.invalid', { headers: { range: 'bytes=0-0' } })
  for (const mode of ['ok', 'bad-origin', 'wrong-bucket', 'wrong-object', 'wrong-range', 'different-length', 'after-sign']) {
    let now = slot.start
    let calls = 0
    const response = await servePrivateDressAsset(request, slot, 'performance', ready.performance, {
      now: () => now,
      invitation: async () => validExpiry,
      sign: async (bucket, object) => {
        assert.equal(bucket, 'cafe-sativa-dress-rehearsal')
        if (mode === 'after-sign') now = slot.end
        const origin = mode === 'bad-origin' ? 'https://other.invalid' : 'https://nwfxvhqbjtfvoopcadff.supabase.co'
        const signedBucket = mode === 'wrong-bucket' ? 'cafe-sativa-content' : bucket
        return origin + '/storage/v1/object/sign/' + signedBucket + '/' + (mode === 'wrong-object' ? ready.intro.object : object) + '?token=fixture'
      },
      fetch: async (_, init) => {
        calls++
        assert.equal(init.headers.Range, 'bytes=0-0')
        assert.equal(init.redirect, 'error')
        return new Response('x', { status: 206, headers: {
          'Content-Length': mode === 'different-length' ? '2' : '1',
          'Content-Range': mode === 'wrong-range' ? 'bytes 1-1/4096' : 'bytes 0-0/4096',
          Location: 'https://private.invalid/?token=fixture',
        } })
      },
    })
    assert.equal(response.status, mode === 'ok' ? 206 : mode === 'after-sign' ? 404 : 503, mode)
    assert.equal(calls, ['ok', 'wrong-range', 'different-length'].includes(mode) ? 1 : 0)
    assert.equal(response.headers.get('location'), null)
    assert.match(response.headers.get('cache-control'), /private, no-store/)
  }
})

test('the rehearsal UI shows a hold for missing media and the old endpoint rejects the dress slot', () => {
  const page = readFileSync('app/stage/rehearsal/page.tsx', 'utf8')
  const legacy = readFileSync('app/api/stage/rehearsal-media/route.ts', 'utf8')
  assert.match(page, /!dressMediaReady \|\| now < slot\.dress\.doors/)
  for (const name of ['intro', 'captions', 'performance', 'reveal']) assert.match(page, new RegExp('/api/stage/rehearsal-cue/' + name))
  assert.match(legacy, /if \(!slot \|\| slot\.dress \|\|/)
})
