const { readFileSync } = require('node:fs')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')
const policy = require('../lib/events/stage-conversation-policy.ts')

function fixture({ key = 'synthetic', canon = true, result, failure = false } = {}) {
  const calls = { paid: 0, events: 0 }
  const context = { exports: {}, AbortSignal, process: { env: { ANTHROPIC_API_KEY: key } }, require(name) {
    if (name === '@anthropic-ai/sdk') return { default: class {
      messages = { create: async request => {
        calls.paid++
        calls.model = request
        if (failure) throw new Error('synthetic outage')
        return { content: [{ type: 'text', text: result ?? '{"action":"answer","reply":"Yes, you can rewind the rehearsal and see my welcome again."}' }] }
      } }
    } }
    if (name.endsWith('/concierge-canon')) return { canonicalConciergeHost: async id => canon ? { context: `Verified identity for ${id}` } : null }
    if (name === '@/lib/events') return { getUpcomingEvents: async options => { calls.events++; assert.equal(options.futureOnly, true); return [] } }
    if (name.endsWith('/stage-conversation-policy')) return policy
    if (name.endsWith('/concierge/programming')) return { voiceProgrammingContext: () => 'Verified rehearsal facts' }
    if (name.endsWith('/concierge/response-engine')) return { generateConciergeResponse: async (input, provider) => {
      const completion = await provider(input)
      return completion.content[0].text
    } }
    throw Error(name)
  } }
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/../lib/events/stage-conversation.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context)
  const history = [{ role: 'user', content: 'How does the rehearsal player work?' }, { role: 'assistant', content: 'Play it whenever you are ready.' }]
  return { calls, ask: (question = 'Can I rewind to your welcome?') => context.exports.answerSoloStageQuestion({
    host: 'laviche', persona: 'Approved Laviche voice and character', question, history,
  }) }
}

test('an ordinary follow-up uses the approved host, verified program, and only the supplied thread with one bounded call', async () => {
  const f = fixture()
  assert.match(await f.ask(), /rewind the rehearsal/)
  assert.equal(f.calls.paid, 1)
  assert.equal(f.calls.model.max_tokens, 280)
  assert.match(f.calls.model.canonicalContext, /Verified identity for laviche/)
  assert.match(f.calls.model.hostSystemPrompt, /Approved Laviche voice and character/)
  assert.match(f.calls.model.liveProgramming, /Verified rehearsal facts/)
  assert.equal(f.calls.model.messages.length, 3)
  assert.match(f.calls.model.messages[0].content, /rehearsal player/)
})

test('no model call for sensitive input, missing credentials or missing approved persona source', async () => {
  for (const [options, question] of [[{}, 'Can you look up my payment?'], [{ canon: false }, undefined],
    [{ key: '' }, undefined], [{}, 'Email me at guest@example.com']]) {
    const f = fixture(options)
    assert.equal(await f.ask(question), null)
    assert.equal(f.calls.paid, 0)
  }
})

test('non-contract output, sensitive links, moderator handoff, and provider failure never become host replies', async () => {
  for (const options of [{ result: 'Plain text' }, { result: '{"action":"review"}' },
    { result: '{"action":"answer","reply":"See https://example.com"}' }, { failure: true }]) {
    assert.equal(await fixture(options).ask(), null)
  }
})
