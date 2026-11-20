const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')

const source = fs.readFileSync('lib/events/stage-program.ts', 'utf8')
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const scope = { exports: {}, URL }
vm.runInNewContext(output, scope)
const { validStageProgram, validStageProgramCta, stageProgramStatusLabel } = scope.exports

const program = {
  id: 'artist-show-canary', slug: 'artist-show', title: 'Artist — Song', subtitle: 'A Stage performance', performer: 'Artist',
  format: 'concert', state: 'preview', prerecorded: true,
  media: { video: '/api/video', poster: '/api/poster', accessibleLabel: 'Artist performing' },
  lobby: { accessibility: 'Captioned performance.', chatRules: ['Be welcoming.'] },
  interaction: { mode: 'local_rehearsal', reactions: ['Encore'] },
  ctas: [{ id: 'listen', kind: 'music', label: 'Listen', verification: 'held', heldReason: 'Exact destination not verified.' }],
  replay: { status: 'not_started' }, disclosure: 'AI-assisted production.',
}

test('generic preview program passes without inventing a destination', () => {
  assert.equal(validStageProgram(program), true)
  assert.equal(stageProgramStatusLabel(program), 'Private canary preview')
})

test('held CTA fails closed and verified CTA requires HTTPS evidence', () => {
  assert.equal(validStageProgramCta({ id: 'listen', kind: 'music', label: 'Listen', verification: 'held', heldReason: 'Not verified.' }), true)
  assert.equal(validStageProgramCta({ id: 'listen', kind: 'music', label: 'Listen', verification: 'held', destination: 'https://example.com', heldReason: 'Not verified.' }), false)
  assert.equal(validStageProgramCta({ id: 'listen', kind: 'music', label: 'Listen', verification: 'verified', destination: 'http://example.com', verificationEvidence: 'owner:approved' }), false)
  assert.equal(validStageProgramCta({ id: 'listen', kind: 'music', label: 'Listen', verification: 'verified', destination: 'https://example.com', verificationEvidence: 'owner:approved' }), true)
})

test('a prerecorded feed cannot be labeled live', () => {
  assert.equal(validStageProgram({ ...program, state: 'live' }), false)
  assert.equal(validStageProgram({ ...program, state: 'premiere' }), true)
})
