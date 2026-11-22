const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

function load(name) {
  const scope = { exports: {} }
  require('node:vm').runInNewContext(ts.transpileModule(fs.readFileSync(`lib/events/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, scope)
  return scope.exports
}
const { ahnikaTrackCta, AHNIKA_ALREADY_GONE_SPOTIFY } = load('ahnika-track-cta')
const { stageLinkCueDelay } = load('stage-link-cue')
const kickoff = Date.parse('2026-12-01T06:00:00.000Z')
const end = kickoff + 99_700
const exact = 'https://open.spotify.com/track/5GrVWG25UDXuOyOBjxX0jX'

test('only the approved exact artist track receives a cue', () => {
  assert.equal(AHNIKA_ALREADY_GONE_SPOTIFY, exact)
  assert.equal(ahnikaTrackCta(exact, kickoff, end)?.showAt, kickoff + 75_000)
  assert.equal(ahnikaTrackCta(exact, kickoff, end)?.url, exact)
  for (const url of [undefined, '', 'https://open.spotify.com/artist/3TXmAFRVDJi3IWRMTel4P6',
    'https://open.spotify.com/track/another-track', exact + '?redirect=elsewhere',
    exact.replace('open.spotify.com', 'open.spotify.com.other.example')]) {
    assert.equal(ahnikaTrackCta(url, kickoff, end), null)
  }
})

test('the cue is hidden until 1:15, then remains available after the show', () => {
  const { showAt } = ahnikaTrackCta(exact, kickoff, end)
  assert.equal(stageLinkCueDelay(showAt, kickoff, 0), 75_000)
  assert.equal(stageLinkCueDelay(showAt, kickoff, 74_999), 1)
  assert.equal(stageLinkCueDelay(showAt, kickoff, 75_000), 0)
  assert.equal(stageLinkCueDelay(showAt, end, 0), 0)
})

test('a late arrival receives the same cue time and invalid timing fails closed', () => {
  assert.equal(ahnikaTrackCta(exact, kickoff, kickoff + 75_000), null)
  assert.equal(ahnikaTrackCta(exact, NaN, end), null)
  assert.equal(ahnikaTrackCta(exact, kickoff, Infinity), null)
  assert.equal(stageLinkCueDelay(kickoff + 75_000, kickoff + 60_000, 14_000), 1000)
  for (const invalid of [NaN, Infinity, -1]) {
    assert.equal(stageLinkCueDelay(kickoff + 75_000, kickoff, invalid), null)
  }
})
