const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

const scope = { exports: {} }
runInNewContext(ts.transpileModule(readFileSync('lib/events/stage-lobby.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, scope)
const { stageLobbyPhase } = scope.exports
const slot = '2026-12-01T06:00:00Z'
const time = Date.parse(slot)

test('house intro appears only in the final 30 seconds without moving kickoff', () => {
  assert.equal(stageLobbyPhase(slot, time - 30_001), 'lobby')
  assert.equal(stageLobbyPhase(slot, time - 30_000), 'intro')
  assert.equal(stageLobbyPhase(slot, time - 1), 'intro')
  assert.equal(stageLobbyPhase(slot, time), 'kickoff')
  assert.equal(stageLobbyPhase(slot, time + 20_000), 'kickoff')
})

test('invalid event clocks cannot show the introduction', () => {
  assert.equal(stageLobbyPhase('invalid', time), 'unavailable')
  assert.equal(stageLobbyPhase(slot, NaN), 'unavailable')
})
