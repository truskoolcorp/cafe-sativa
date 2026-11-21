const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')
const scope = { exports: {}, URL }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/events/stage-release-evidence.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, scope)
const { reconcileStageRelease } = scope.exports
const kickoffMs = Date.parse('2026-12-01T06:00:00Z')
const endMs = kickoffMs + 99700
const dueMs = kickoffMs - 86400000
const binding = {
  programId: 'stage-canary',
  eventUrl: 'https://www.cafe-sativa.com/events/stage-canary',
  kickoffMs, endMs,
  promotion: { metricoolPostId: '123', dueMs, graceMs: 3600000 },
}
const surface = (kind, observedMs) => ({
  kind, programId: binding.programId, eventUrl: binding.eventUrl, observedMs, evidenceId: `fixture:${kind}`,
})
const published = (network) => ({
  network, brandId: '7605217', metricoolPostId: '123', status: 'published',
  observedMs: dueMs + 10000, publicReadbackMs: dueMs + 12000,
  providerId: `${network}-fixture`, publicUrl: `https://www.${network}.com/reel/fixture/`,
})
const surfaces = [
  surface('lobby', kickoffMs - 1), surface('playback', kickoffMs + 10),
  surface('moderation', kickoffMs + 20), surface('destination', kickoffMs - 20),
  surface('replay', endMs + 10),
]
const now = endMs + 100

test('all surfaces and both independent network receipts are required', () => {
  const facebook = published('facebook')
  assert.equal(reconcileStageRelease(binding, {surfaces, networks: [facebook]}, now).complete, false)
  assert.equal(reconcileStageRelease(binding, {surfaces, networks: [facebook, published('instagram')]}, now).complete, true)
})

test('provider published without independent readback is not a complete receipt', () => {
  const facebook = {...published('facebook'), publicReadbackMs: undefined}
  const result = reconcileStageRelease(binding, {surfaces, networks: [facebook, published('instagram')]}, now)
  assert.equal(result.checks.facebook, 'needs_reconciliation')
  assert.equal(result.checks.instagram, 'verified')
})

test('overdue scheduling is ambiguous, not failure or retry authority', () => {
  const facebook = {...published('facebook'), status: 'scheduled', observedMs: dueMs}
  const evidence = {surfaces: [], networks: [facebook]}
  assert.equal(reconcileStageRelease(binding, evidence, dueMs + 30000).checks.facebook, 'pending')
  assert.equal(reconcileStageRelease(binding, evidence, now).checks.facebook, 'needs_reconciliation')
})

test('a confirmed single-network failure does not demote the verified sibling', () => {
  const facebook = {...published('facebook'), status: 'failed'}
  const result = reconcileStageRelease(binding, {surfaces, networks: [facebook, published('instagram')]}, now)
  assert.equal(result.checks.facebook, 'failed')
  assert.equal(result.checks.instagram, 'verified')
  assert.equal(result.complete, false)
})

test('wrong brand, post, URL host, and contradictory provider evidence fail closed', () => {
  const facebook = published('facebook')
  for (const input of [
    [{...facebook, brandId: '5373515'}],
    [{...facebook, metricoolPostId: 'other'}],
    [{...facebook, publicUrl: 'https://facebook.com.example.com/reel/fixture'}],
    [facebook, {...facebook, status: 'failed'}],
  ]) assert.equal(reconcileStageRelease(binding, {surfaces, networks: input}, now).checks.facebook, 'needs_reconciliation')
})

test('preview URLs, rehearsal observations, pre-end replay and future evidence do not count', () => {
  const evidence = {networks: [], surfaces: [
    {...surface('lobby', kickoffMs - 1), eventUrl: 'https://preview.example.com/events/stage-canary'},
    surface('moderation', kickoffMs - 100), surface('replay', endMs - 1),
    surface('destination', now + 1),
  ]}
  const {checks} = reconcileStageRelease(binding, evidence, now)
  assert.equal(checks.lobby, 'needs_reconciliation')
  assert.equal(checks.moderation, 'needs_reconciliation')
  assert.equal(checks.replay, 'held')
  assert.equal(checks.destination, 'held')
})
