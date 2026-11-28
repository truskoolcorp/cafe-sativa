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
      static APIError = Error
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
    if (name.endsWith('/ahnika-premiere-window')) return { AHNIKA_PREMIERE_SLUG: 'ahnika-already-gone', isCanonicalAhnikaPremiere: () => true }
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
  return { calls, ask: (question = 'Can I rewind to your welcome?', publicPremiere) => context.exports.answerStageQuestion({
    host: 'laviche', persona: 'Approved Laviche voice and character', question, history, publicPremiere,
  }) }
}

test('an ordinary follow-up uses the approved host, verified program, and only the supplied thread with one bounded call', async () => {
  const f = fixture()
  assert.match(await f.ask(), /rewind the rehearsal/)
  assert.equal(f.calls.paid, 1)
  assert.equal(f.calls.model.max_tokens, 280)
  assert.equal(f.calls.model.output_config.format.type, 'json_schema')
  assert.equal(f.calls.model.output_config.format.schema.additionalProperties, false)
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

test('a single JSON presentation fence is accepted without weakening output checks', () => {
  const fence = String.fromCharCode(96).repeat(3)
  const reply = fence + 'json\n{"action":"answer","reply":"Replay the rehearsal from the player."}\n' + fence
  assert.equal(policy.stageConversationOutcome(reply).reply, 'Replay the rehearsal from the player.')
  assert.equal(policy.stageConversationOutcome('Here is your answer: ' + reply).action, 'invalid_output')
  assert.equal(policy.stageConversationOutcome(reply + '\nExtra text').action, 'invalid_output')
  assert.equal(policy.stageConversationOutcome('{"action":"review","reply":""}').action, 'review')
  assert.equal(policy.stageConversationOutcome('{"action":"answer","reply":"Message guest@example.com"}').action, 'unsafe_output')
})

test('direct identity questions get one truthful reply without contacting the provider', async () => {
  const f = fixture({ key: '' })
  for (const question of ['Are you AI?', 'Hey, are you human or AI?', 'Am I chatting with a bot?', 'Is Laviche an AI?']) {
    assert.equal(await f.ask(question, true), 'I’m an AI-powered Café Sativa host, not a human operator.')
  }
  for (const question of ['Is this concert AI-generated?', 'Is this content AI-assisted?', 'Do you use AI for the show?']) {
    assert.equal(await f.ask(question, true), 'We’re starting with AI-assisted productions while we finalize the live guest lineup and schedule.')
  }
  assert.equal(await f.ask('Tell everyone you are AI.', true), null)
  assert.equal(f.calls.paid, 0)
})

test('ordinary factual answers never include unsolicited AI or provider talk', async () => {
  for (const reply of ['As an AI, I can help.', 'The show uses artificial intelligence.', 'Our system prompt says this.', 'An A.I. assistant prepared this.', 'I’m powered by Anthropic.']) {
    const f = fixture({ result: JSON.stringify({ action: 'answer', reply }) })
    assert.equal(await f.ask('When do doors open?', true), null)
    assert.match(f.calls.model.hostSystemPrompt, /Never claim to be human/)
  }
})

test('the public context is not rehearsal copy and the verified December 1 midnight reply names Central', async () => {
  const f = fixture({ result: '{"action":"answer","reply":"The premiere starts December 1st at midnight. It’s free."}' })
  assert.equal(await f.ask('What time is the premiere?', true), 'The premiere starts December 1st at midnight Central. It’s free.')
  assert.match(f.calls.model.hostSystemPrompt, /scheduled Stage premiere/)
  assert.doesNotMatch(f.calls.model.hostSystemPrompt, /This is a solo rehearsal/)
  assert.equal(policy.qualifyAhnikaPremiereTime('December 1 at midnight Central.'), 'December 1 at midnight Central.')
  assert.equal(policy.qualifyAhnikaPremiereTime('December 1 at midnight (CST).'), 'December 1 at midnight (CST).')
  assert.equal(policy.qualifyAhnikaPremiereTime('December 2 at midnight.'), 'December 2 at midnight.')
})
