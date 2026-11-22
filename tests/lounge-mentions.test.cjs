const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')
const vm = require('node:vm')
const { loungeGuestCode } = require('../lib/lounge-speaker.ts')
const source = readFileSync(`${__dirname}/../lib/lounge-mentions.ts`, 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
const api = vm.runInNewContext(`${stripTypeScriptTypes(source)};({loungeMentionHandles,loungeMentionParts,loungeMentionQuery,insertLoungeMention})`, { loungeGuestCode })

test('a bare @ starts a search; duplicate participant names receive selectable handles', () => {
  const handles = api.loungeMentionHandles(new Map([['a', 'Ana-Maria'], ['b', 'Guest Code'], ['c', 'Guest Code']]), 'rehearsal')
  assert.equal(api.loungeMentionQuery('@'), '')
  assert.equal(api.loungeMentionQuery('hello @Mar'), 'Mar')
  assert.equal(api.loungeMentionQuery('hello@example'), null)
  assert.equal(handles.get('a'), 'Ana-Maria')
  assert.match(handles.get('b'), /^Guest-Code-/)
  assert.notEqual(handles.get('b'), handles.get('c'))
})

test('selection inserts the full handle and preserves text after the current token', () => {
  assert.equal(api.insertLoungeMention('@', 1, 'Guest-ABC').text, '@Guest-ABC ')
  const chosen = api.insertLoungeMention('Hi @AnXYZ and welcome', 6, 'Ana-Maria')
  assert.equal(chosen.text, 'Hi @Ana-Maria and welcome')
  assert.equal(chosen.caret, 'Hi @Ana-Maria '.length)
  assert.equal(api.insertLoungeMention('', 500, 'Guest-ABC').caret, '@Guest-ABC '.length)
})

test('shared text remains intact and email addresses and URLs are not highlighted', () => {
  const text = '@Ana-Maria: hi! user@example.org https://example.org/@hidden'
  const parts = api.loungeMentionParts(text)
  assert.equal(parts.map(p => p.text).join(''), text)
  assert.equal(parts.filter(p => p.handle).map(p => p.handle).join(','), 'ana-maria')
})
