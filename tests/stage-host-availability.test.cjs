const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')

function load(file) {
  const ctx = { exports: {}, Date, require: spec => load(path.resolve(path.dirname(file), `${spec}.ts`)) }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, ctx)
  return ctx.exports
}

const { stageHostIsPerforming, VOICE_PERFORMANCE_BUFFER_MS } = load(path.resolve('lib/events/stage-host-availability.ts'))
const kickoff = Date.parse('2026-12-01T06:00:00Z')

test('the Ahnika blackout starts exactly at kickoff and ends at the performance end', () => {
  assert.equal(stageHostIsPerforming('ahnika', kickoff - 1), false)
  assert.equal(stageHostIsPerforming('ahnika', kickoff), true)
  assert.equal(stageHostIsPerforming('ahnika', kickoff + 99_699), true)
  assert.equal(stageHostIsPerforming('ahnika', kickoff + 99_700), false)
  assert.equal(stageHostIsPerforming('laviche', kickoff), false)
  assert.equal(stageHostIsPerforming('ahnika', Date.parse('2026-11-22T20:03:00Z')), false)
})

test('real-time sessions have time to disconnect, and can reconnect at the exact end', () => {
  assert.equal(stageHostIsPerforming('ahnika', kickoff - VOICE_PERFORMANCE_BUFFER_MS - 1, VOICE_PERFORMANCE_BUFFER_MS), false)
  assert.equal(stageHostIsPerforming('ahnika', kickoff - VOICE_PERFORMANCE_BUFFER_MS, VOICE_PERFORMANCE_BUFFER_MS), true)
  assert.equal(stageHostIsPerforming('ahnika', kickoff + 99_700, VOICE_PERFORMANCE_BUFFER_MS), false)
  assert.equal(stageHostIsPerforming('laviche', kickoff, VOICE_PERFORMANCE_BUFFER_MS), false)
})
