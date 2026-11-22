const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')
const vm = require('node:vm')
const { loungeGuestCode } = require('../lib/lounge-speaker.ts')
const ctx = vm.createContext({ loungeGuestCode })
const code = stripTypeScriptTypes(readFileSync(`${__dirname}/../lib/lounge-mentions.ts`, 'utf8').replace(/^import .*\n/gm, ''))
vm.runInContext(code.replace(/export /g, '')+';this.helpers={loungeMentionHandles,loungeMentionParts,loungeMentionQuery}',ctx)
const { loungeMentionHandles, loungeMentionParts, loungeMentionQuery } = ctx.helpers

test('human names yield selectable handles; ambiguous old labels are disambiguated', () => {
  const handles = loungeMentionHandles(new Map([['a','Ana-Maria'],['b','Café Guest'],['c','Café Guest']]),'stage')
  assert.equal(handles.get('a'),'Ana-Maria')
  assert.match(handles.get('b'),/^Café-Guest-/)
  assert.notEqual(handles.get('b'),handles.get('c'))
  assert.equal(loungeMentionQuery('Hello @Ana-'),'Ana-')
  assert.equal(loungeMentionQuery('hello@example'),null)
})

test('mentions retain the shared message text without tagging email addresses or links', () => {
  const text='@Ana-Maria: Nice to see you! @Café-Guest. user@example.org https://example.org/@example'
  const parts=loungeMentionParts(text)
  assert.equal(parts.map(p=>p.text).join(''),text)
  assert.equal(parts.filter(p=>p.handle).map(p=>p.handle).join(','),'ana-maria,café-guest')
})
