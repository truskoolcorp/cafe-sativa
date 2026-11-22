const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const sandbox = { exports: {}, Date, Intl, require(name) {
  assert.equal(name, '@/lib/events/hit-em-premiere')
  return { publicHitEmPremiere: () => null }
} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../lib/concierge/programming.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, sandbox)
const { voiceProgrammingContext } = sandbox.exports

test('voice gets only future confirmed event facts, independent of old schedule records', () => {
  const now = new Date('2026-11-22T21:45:00Z')
  const event = (title, starts_at, status='scheduled') => ({ title, starts_at, status, category:'stage', slug:'fixture', access:'free', ticket_price_cents:0 })
  const rows = [event('Ahnika Merlot — Already Gone','2026-12-01T06:00:00Z'), event('Hit Em Release Party','2026-11-11T06:00:00Z'),
    event('Canceled entry','2026-12-02T06:00:00Z','cancelled'), event('Exactly now',now.toISOString()), event('Unknown date','invalid')]
  const context = voiceProgrammingContext(rows, now)
  assert.match(context, /November 22, 2026/)
  assert.match(context, /Ahnika Merlot/)
  assert.match(context, /December 1, 2026 at 12:00 AM CST/)
  assert.doesNotMatch(context, /Hit Em Release Party|Canceled entry|Exactly now|Unknown date/)
  assert.match(context, /Do not volunteer whether a performance was recorded/)
  assert.match(context, /If asked directly whether her performance is live/)
  assert.equal(context, voiceProgrammingContext(rows, new Date(now.getTime()+30_000)))
})
