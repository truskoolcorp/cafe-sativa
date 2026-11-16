// Offline regression tests. No provider credentials, SDK calls or private history access.
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
function load(file) {
  const context = { exports: {}, Intl, Date, require(name) {
    if (name.startsWith('@/lib/')) return load(name.replace('@/', '') + '.ts')
    throw new Error(`Unexpected engine dependency: ${name}`)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context)
  return context.exports
}
const engine = load('lib/concierge/response-engine.ts')
const { PROGRAMMING_FACT_RULES } = load('lib/concierge/programming.ts')
const input = { hostSystemPrompt: 'Approved host', canonicalContext: 'Approved identity',
  liveProgramming: '{"events":[]}', messages: [
    { role: 'user', content: 'Prior memory' }, { role: 'assistant', content: 'Prior reply' },
    { role: 'user', content: 'Current turn' }, { role: 'assistant', content: 'Current reply' },
    { role: 'user', content: 'Incoming question' },
  ] }
test('extracted model request exactly preserves original ASK payload and message order', () => {
  const actual = engine.buildConciergeModelRequest(input)
  const original = {
    model: 'claude-haiku-4-5-20251001', max_tokens: 512,
    system: `${input.hostSystemPrompt}\nCurrent approved GLYPH canonical context (use this for identity facts; it supersedes conflicting legacy descriptions):\n${input.canonicalContext}\nVerified website programming: ${input.liveProgramming}\n${PROGRAMMING_FACT_RULES}\nOnly announce dates and availability from the live programming records. An approved concept preview is not a booked performance or an operating physical venue.`,
    messages: input.messages,
  }
  assert.equal(JSON.stringify(actual), JSON.stringify(original))
  assert.equal(engine.CONCIERGE_MODEL, original.model)
})
test('injected transport is called once; text block joining and fallback are unchanged', async () => {
  for (const [content, expected] of [
    [[{ type: 'text', text: '  Hello' }, { type: 'tool_use', text: 'ignored' }, { type: 'text', text: ' world  ' }], 'Hello world'],
    [[], "Sorry, I didn't catch that — try me again?"],
    [[{ type: 'text', text: ' \n ' }], "Sorry, I didn't catch that — try me again?"],
  ]) {
    let calls = 0
    assert.equal(await engine.generateConciergeResponse(input, async request => {
      calls++
      assert.equal(JSON.stringify(request), JSON.stringify(engine.buildConciergeModelRequest(input)))
      return { content }
    }), expected)
    assert.equal(calls, 1)
  }
})
test('upstream errors propagate by identity for existing ASK error/debug handling', async () => {
  const error = Object.assign(new Error('Synthetic failure'), { status: 429, error: { type: 'rate_limit_error' } })
  await assert.rejects(engine.generateConciergeResponse(input, async () => { throw error }), caught => caught === error)
})
test('public invocation cannot inherit a preceding private ASK invocation', async () => {
  await engine.generateConciergeResponse(input, async () => ({ content: [{ type: 'text', text: 'private reply' }] }))
  const publicInput = { ...input, messages: [{ role: 'user', content: 'Public question' }] }
  await engine.generateConciergeResponse(publicInput, async request => {
    assert.equal(JSON.stringify(request.messages), JSON.stringify(publicInput.messages))
    assert.ok(!JSON.stringify(request).includes('Prior memory'))
    return { content: [{ type: 'text', text: 'Public answer' }] }
  })
})
