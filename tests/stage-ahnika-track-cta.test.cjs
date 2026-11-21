const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
const scope = { exports: {} }
require('node:vm').runInNewContext(ts.transpileModule(fs.readFileSync('lib/events/ahnika-track-cta.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, scope)
const { ahnikaTrackCta, AHNIKA_ALREADY_GONE_SPOTIFY } = scope.exports
const doors = Date.parse('2026-12-01T05:45:00.000Z')

test('only the approved exact artist track is exposed', () => {
  assert.equal(ahnikaTrackCta(AHNIKA_ALREADY_GONE_SPOTIFY, doors, doors), AHNIKA_ALREADY_GONE_SPOTIFY)
  for (const url of [undefined, '', 'https://open.spotify.com/artist/3TXmAFRVDJi3IWRMTel4P6',
    'https://open.spotify.com/track/another-track', AHNIKA_ALREADY_GONE_SPOTIFY + '?redirect=elsewhere',
    AHNIKA_ALREADY_GONE_SPOTIFY.replace('open.spotify.com', 'open.spotify.com.other.example')]) {
    assert.equal(ahnikaTrackCta(url, doors, doors), null)
  }
})

test('held through the pre-lobby phase and on invalid clock values', () => {
  assert.equal(ahnikaTrackCta(AHNIKA_ALREADY_GONE_SPOTIFY, doors - 1, doors), null)
  assert.equal(ahnikaTrackCta(AHNIKA_ALREADY_GONE_SPOTIFY, NaN, doors), null)
  assert.equal(ahnikaTrackCta(AHNIKA_ALREADY_GONE_SPOTIFY, doors, NaN), null)
})
