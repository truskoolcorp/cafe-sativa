const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loungeDisplayName, loungeGuestCode, loungeSpeakerAccent } = require('../lib/lounge-speaker.ts')

test('guest labels are stable and room-specific; generic names and addresses use aliases', () => {
  const label = loungeDisplayName(null, 'stage', 'user-1')
  assert.match(label, /^Guest [A-Z0-9]{6}$/)
  for (const legacy of [' Member ', 'member', 'Rehearsal guest', 'private@example.com']) {
    assert.equal(loungeDisplayName(legacy, 'stage', 'user-1'), label)
  }
  assert.equal(loungeDisplayName(' Terrace  Listener ', 'stage', 'user-1'), 'Terrace Listener')
  assert.notEqual(loungeGuestCode('stage', 'user-1'), loungeGuestCode('stage', 'user-2'))
  assert.notEqual(loungeGuestCode('stage', 'user-1'), loungeGuestCode('lounge', 'user-1'))
})

test('speaker accents are stable, distinguish tested speakers and stay readable on dark chat cards', () => {
  assert.notEqual(loungeSpeakerAccent('stage', 'user-1'), loungeSpeakerAccent('stage', 'user-2'))
  assert.equal(loungeSpeakerAccent('stage', 'user-1'), loungeSpeakerAccent('stage', 'user-1'))
  function luminance(hex) {
    return hex.slice(1).match(/../g).reduce((sum, c, i) => {
      const v = Number.parseInt(c, 16) / 255
      return sum + [0.2126, 0.7152, 0.0722][i] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    }, 0)
  }
  for (let i = 0; i < 120; i++) {
    const accent = loungeSpeakerAccent('stage', `user-${i}`)
    assert.ok((luminance(accent) + 0.05) / (luminance('#130c08') + 0.05) >= 4.5, accent)
  }
})
