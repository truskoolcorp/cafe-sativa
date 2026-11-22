const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')
const vm = require('node:vm')

const source = path => stripTypeScriptTypes(readFileSync(`${__dirname}/../${path}`, 'utf8')
  .replace(/^import .*\n/gm, '').replace(/^export /gm, ''))
const ctx = vm.createContext({})
vm.runInContext(source('lib/events/stage-lobby.ts') + '\n' + source('lib/events/stage-host-intro.ts') +
  '\nthis.exports = { approvedAhnikaHostIntro, stageHostIntroPosition }', ctx)
const { approvedAhnikaHostIntro, stageHostIntroPosition } = ctx.exports

test('only an exact reviewed release identifier enables the three same-origin assets', () => {
  for (const unapproved of [undefined, '', 'true', 'https://example.com/video', '../path', 'AA'.repeat(32), '0'.repeat(65), '0'.repeat(63)]) {
    assert.equal(approvedAhnikaHostIntro(unapproved), undefined)
  }
  const release = 'a1'.repeat(32)
  const assets = approvedAhnikaHostIntro(release)
  assert.equal(assets.video, `/stage-host-intros/ahnika-already-gone/${release}/intro.mp4`)
  assert.equal(assets.captions, `/stage-host-intros/ahnika-already-gone/${release}/intro.en.vtt`)
  assert.equal(assets.revealPoster, `/stage-host-intros/ahnika-already-gone/${release}/reveal.webp`)
})

test('the opener is broadcast-synchronized and ends at the original kickoff', () => {
  const kickoff = Date.parse('2026-12-01T06:00:00Z')
  assert.equal(stageHostIntroPosition(kickoff, kickoff - 30001, 30), null)
  assert.equal(stageHostIntroPosition(kickoff, kickoff - 30000, 30), 0)
  assert.equal(stageHostIntroPosition(kickoff, kickoff - 2500, 30), 27.5)
  assert.equal(stageHostIntroPosition(kickoff, kickoff - 2000, 30), 28)
  assert.equal(stageHostIntroPosition(kickoff, kickoff, 30), null)
  for (const duration of [10, 29.5, 30.5, 60, Infinity, NaN]) {
    assert.equal(stageHostIntroPosition(kickoff, kickoff - 5000, duration), null)
  }
})
