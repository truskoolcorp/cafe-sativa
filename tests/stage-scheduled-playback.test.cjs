const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const exportsShim = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/events/scheduled-playback.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsShim, Date })
const { scheduledPlayback } = exportsShim
const start = '2026-12-01T06:00:00Z'
const at = Date.parse(start)
test('player is unavailable before kickoff and after the exact cut duration', () => {
  assert.equal(scheduledPlayback(start, 99700, at - 1).phase, 'lobby')
  assert.equal(scheduledPlayback(start, 99700, at).position, 0)
  assert.equal(scheduledPlayback(start, 99700, at + 99699).phase, 'premiere')
  assert.equal(scheduledPlayback(start, 99700, at + 99700).phase, 'ended')
})
test('late arrival and refresh use the same absolute premiere position', () => {
  assert.equal(scheduledPlayback(start, 99700, at + 25000).position, 25)
  assert.equal(scheduledPlayback(start, 99700, at + 44000).position, 44)
})
test('invalid schedules and durations fail closed', () => {
  assert.equal(scheduledPlayback('invalid', 99700, at).phase, 'unavailable')
  assert.equal(scheduledPlayback(start, 0, at).phase, 'unavailable')
})
