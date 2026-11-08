const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
function load(file) {
  const context = { exports: {}, Intl, Date, require(name) {
    if (name === '@/lib/events/hit-em-premiere') return load('lib/events/hit-em-premiere.ts')
    throw new Error(`Unexpected import: ${name}`)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context)
  return context.exports
}
const { HIT_EM_PREMIERE: approved } = load('lib/events/hit-em-premiere.ts')
const { conciergeEventFacts, PROGRAMMING_FACT_RULES, verifiedPremiereAnswer } = load('lib/concierge/programming.ts')
const event = { id: approved.eventId, slug: approved.slug, title: approved.title,
  starts_at: approved.startsAt, ends_at: null, status: 'scheduled',
  ticket_price_cents: 0, access: 'free', free_for_tiers: [], description: 'Public premiere', category: 'stage' }
test('approved party has midnight Dallas, explicit UTC, free admission and exact shared-chat policy', () => {
  const facts = conciergeEventFacts(event)
  assert.match(facts.startsAtLocal, /Wednesday, November 11, 2026/)
  assert.match(facts.startsAtLocal, /12:00 AM CST/)
  assert.equal(facts.startsAtUtc, '2026-11-11T06:00:00.000Z')
  assert.equal(facts.timeZone, 'America/Chicago')
  assert.equal(facts.ticketPriceCents, 0)
  assert.equal(facts.access, 'free')
  assert.match(facts.publicGathering.admission, /No Café Sativa account, membership, or ticket/)
  assert.equal(facts.publicGathering.sharedChatUrl, 'https://www.youtube.com/watch?v=ZYA0r9JM6eA')
  assert.match(facts.publicGathering.chatPolicy, /YouTube sign-in is required to post/)
  assert.match(facts.publicGathering.chatPolicy, /concierge chat is separate/)
  assert.ok(conciergeEventFacts({ ...event, access: 'ticketed' }).publicGathering)
})
test('special public policy never leaks to changed, paid, canceled, ended or unrelated events', () => {
  for (const changed of [{ id: 'other' }, { slug: 'other' }, { title: 'other' },
    { starts_at: '2026-11-11T00:00:00Z' }, { ticket_price_cents: 1000 },
    { access: 'purchase_required' }, { status: 'canceled' }, { status: 'ended' }]) {
    assert.equal(conciergeEventFacts({ ...event, ...changed }).publicGathering, undefined)
  }
})
test('descriptions are bounded; paid events retain actual price/access without free policy', () => {
  const facts = conciergeEventFacts({ ...event, id: 'another', ticket_price_cents: 2500,
    access: 'purchase_required', description: 'x'.repeat(2000) })
  assert.equal(facts.description.length, 1200)
  assert.equal(facts.ticketPriceCents, 2500)
  assert.equal(facts.access, 'purchase_required')
  assert.equal(facts.publicGathering, undefined)
  assert.equal(conciergeEventFacts({ ...event, starts_at: 'invalid' }).startsAtLocal, null)
})
test('route supplies verified facts and explicit timestamp/admission precedence to the model', () => {
  const route = fs.readFileSync('app/api/concierge/route.ts', 'utf8')
  assert.match(route, /events:events\.map\(conciergeEventFacts\)/)
  assert.ok(route.includes('${PROGRAMMING_FACT_RULES}'))
  assert.match(PROGRAMMING_FACT_RULES, /Do not reinterpret or convert/)
  assert.match(PROGRAMMING_FACT_RULES, /override conflicting legacy tier benefits/)
})
test('explicit party FAQ is deterministic only for the freshly verified approved free event', () => {
  for (const message of ['When is Hit Em?', 'What time is Hit \'Em and what does it cost?',
    'How do I join the Hit Em chat?', 'Where can I watch Hit Em?', 'Is Hit Em free?',
    'Hi Laviche! What date and Dallas time is the Hit Em release party, is it free, and how do I join the chat?',
    'Hi Laviche. For the Hit Em premiere, when does it start in Dallas, is it free, and where do I join the shared live chat?',
    'When is Hit Em, what does it cost, and how do I join the chat?']) {
    const answer = verifiedPremiereAnswer(message, [event])
    assert.match(answer, /November 11, 2026 at 12:00 AM midnight CST/)
    assert.match(answer, /06:00 UTC, not midnight UTC/)
    assert.match(answer, /no Café Sativa account, membership, or ticket/)
    assert.ok(answer.includes(approved.watchUrl))
    assert.match(answer, /YouTube sign-in is required to post/)
    assert.match(answer, /separate from the shared audience chat/)
    assert.equal(verifiedPremiereAnswer(message, [{ ...event, access: 'ticketed' }]), answer)
    assert.equal(verifiedPremiereAnswer(message, []), null)
    for (const changes of [{ id: 'other' }, { ticket_price_cents: 1500 }, { access: 'purchase_required' },
      { status: 'canceled' }, { status: 'ended' }, { starts_at: '2026-11-11T00:00:00Z' }]) {
      assert.equal(verifiedPremiereAnswer(message, [{ ...event, ...changes }]), null)
    }
  }
  assert.equal(verifiedPremiereAnswer('What does the cigar tasting cost?', [event]), null)
  assert.equal(verifiedPremiereAnswer('I like Hit Em music', [event]), null)
  for (const message of ['I liked Hit Em. What does the cigar tasting cost?',
    'Can you write a free verse poem inspired by Hit Em?', 'When was Hit Em recorded?']) {
    assert.equal(verifiedPremiereAnswer(message, [event]), null)
  }
})
