const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const vm = require('node:vm')

const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const exports = {}
  cache.set(file, exports)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports, Date, require: name => load(path.join(path.dirname(file), name + '.ts')) })
  return exports
}
const { privateStagePlaybackSlot, rehearsalAccessEnd, rehearsalInviteCoversCut, soloStageHostTest } = load('lib/events/private-stage-rehearsal.ts')
const { AHNIKA_AUDIENCE_SCHEDULE } = load('lib/events/ahnika-premiere-window.ts')
const production = { VERCEL_ENV: 'production', STAGE_PRIVATE_REHEARSAL_ENABLED: 'true' }
const kickoff = '2026-11-24T14:00:00Z'

test('the exact approved rehearsal gets its own doors, cue, playback end, and Q&A close without changing the public clock', () => {
  const slot = privateStagePlaybackSlot({ ...production, STAGE_PRIVATE_DRESS_KICKOFF: kickoff })
  assert.equal(slot.onDemand, false)
  assert.equal(slot.start, Date.parse(kickoff))
  assert.equal(slot.dress.doors, Date.parse('2026-11-24T13:45:00Z'))
  assert.equal(slot.dress.intro, Date.parse('2026-11-24T13:59:30Z'))
  assert.equal(slot.end, Date.parse('2026-11-24T14:01:39.700Z'))
  assert.equal(rehearsalAccessEnd(slot), Date.parse('2026-11-24T14:16:39.700Z'))
  assert.equal(slot.inviteUntil, Date.parse('2026-11-24T14:20:00Z'))
  assert.equal(AHNIKA_AUDIENCE_SCHEDULE.kickoff, Date.parse('2026-12-01T06:00:00Z'))
  assert.equal(rehearsalInviteCoversCut('2026-11-24T14:05:00Z', rehearsalAccessEnd(slot), slot.inviteUntil), false)
  assert.equal(rehearsalInviteCoversCut('2026-11-24T14:20:00Z', rehearsalAccessEnd(slot), slot.inviteUntil), true)
  assert.equal(soloStageHostTest(slot, 'uid', { ...production, STAGE_PRIVATE_SOLO_HOST_STARTS_AT: kickoff, STAGE_PRIVATE_SOLO_HOST_USER_ID: 'uid' }), false)
})

test('a misspelled or unapproved dress slot fails closed and legacy on-demand setup is unchanged', () => {
  assert.equal(privateStagePlaybackSlot({ ...production, STAGE_PRIVATE_DRESS_KICKOFF: '2026-11-24T15:00:00Z' }), null)
  assert.equal(privateStagePlaybackSlot({ ...production, STAGE_PRIVATE_DRESS_KICKOFF: kickoff, STAGE_PRIVATE_REHEARSAL_ENABLED: 'false' }), null)
  const legacy = privateStagePlaybackSlot({ ...production, STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT: '2026-11-22T21:38:00Z' })
  assert.equal(legacy.onDemand, true)
  assert.equal(legacy.dress, null)
  assert.equal(rehearsalAccessEnd(legacy), legacy.end)
})
