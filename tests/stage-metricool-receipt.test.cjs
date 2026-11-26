const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readStageReceipts } = require('../scripts/stage-metricool-receipt.cjs')

const cue = '2026-12-01T00:00:00Z'
const caption = 'Approved Stage notice'
const checksum = createHash('sha256').update(caption).digest('hex')
const fb = { postId: '12345', postUuid: '8404822223355862333', network: 'facebook',
  expectedFacebookPageId: '123',
  captionSha256: checksum, scheduledAt: cue, mediaUrl: 'https://static.metricool.com/planner/202611/7605217-file-123.jpeg' }
const ig = { ...fb, postId: '12346', postUuid: '-940482222335586233', network: 'instagram' }
const exportFor = (...data) => ({ brandId: '7605217', data })
const postFor = ({ postId, postUuid, network, mediaUrl }, provider) => ({
  id: Number(postId), uuid: postUuid, text: caption, autoPublish: true, draft: false, media: [mediaUrl],
  publicationDate: { dateTime: '2026-11-30T18:00:00', timezone: 'America/Chicago' },
  providers: [{ network, status: 'PENDING', ...provider }],
})
const at = delta => Date.parse(cue) + delta

test('keeps Facebook and Instagram observations independent', () => {
  const publicUrl = 'https://www.facebook.com/123/posts/abc'
  const result = readStageReceipts([fb, ig], exportFor(
    postFor(fb, { status: 'PUBLISHED', id: 'abc', publicUrl }), postFor(ig),
  ), at(1000))
  assert.deepEqual(result.map(r => r.state), ['provider_reported_published', 'scheduled'])
  assert.equal(result[0].providerId, 'abc')
  assert.equal(result[0].publicUrl, publicUrl)
  assert.equal(result[0].publiclyVerified, false)
  assert.equal(result[1].publicUrl, undefined)
})

test('does not treat missing, duplicate, overdue, or early evidence as publication', () => {
  const post = postFor(ig, { status: 'PUBLISHED', id: 'g1', publicUrl: 'https://www.instagram.com/p/g1/' })
  assert.equal(readStageReceipts([ig], exportFor(), at(0))[0].state, 'not_observed')
  assert.equal(readStageReceipts([ig], exportFor(), at(1_800_000))[0].state, 'overdue_unconfirmed')
  assert.equal(readStageReceipts([ig], exportFor(postFor(ig)), at(1_800_000))[0].state, 'overdue_unconfirmed')
  assert.equal(readStageReceipts([ig], exportFor(post, post), at(0))[0].state, 'ambiguous')
  assert.equal(readStageReceipts([ig], exportFor(post), at(-1))[0].state, 'provider_unconfirmed')
  assert.equal(readStageReceipts([ig], exportFor(post), at(0))[0].state, 'provider_reported_published')
})

test('rejects different brand and changed post identity, copy, time, media or network', () => {
  const base = postFor(fb)
  assert.throws(() => readStageReceipts([fb], { brandId: '5373515', data: [base] }, at(0)))
  assert.throws(() => readStageReceipts([fb, fb], exportFor(base), at(0)))
  for (const patch of [{ id: 54321 }, { uuid: '888' }, { text: caption + '!' },
    { publicationDate: { ...base.publicationDate, dateTime: '2026-11-30T17:00:00' } },
    { media: [] }, { draft: true }, { providers: [{ network: 'threads' }] }]) {
    assert.equal(readStageReceipts([fb], exportFor({ ...base, ...patch }), at(0))[0].state, 'binding_mismatch')
  }
})

test('rejects a generic page, lookalike host, credentialed URL, and missing provider ID', () => {
  for (const [id, publicUrl] of [['abc', 'https://facebook.com/123'], ['abc', 'https://facebook.com.example/reel/123'],
    ['abc', 'https://user@facebook.com/reel/123'], ['', 'https://facebook.com/reel/123']]) {
    const p = postFor(fb, { status: 'PUBLISHED', id, publicUrl })
    assert.equal(readStageReceipts([fb], exportFor(p), at(0))[0].state, 'provider_unconfirmed')
  }
})

test('a different Facebook page in a valid receipt cannot pass the destination check', () => {
  const publicUrl = 'https://facebook.com/456/posts/789'
  const [receipt] = readStageReceipts([fb], exportFor(postFor(fb, { status: 'PUBLISHED', id: '789', publicUrl })), at(0))
  assert.deepEqual(receipt, { postId: fb.postId, network: 'facebook', scheduledAt: cue, state: 'destination_mismatch',
    expectedFacebookPageId: '123', permalinkPageId: '456', providerId: '789', publicUrl, publiclyVerified: false })
})

test('an opaque Facebook permalink or a repeated page parameter does not prove page identity', () => {
  for (const publicUrl of ['https://facebook.com/reel/789', 'https://facebook.com/name/posts/789',
    'https://facebook.com/permalink.php?story_fbid=789&id=123&id=456']) {
    const [receipt] = readStageReceipts([fb], exportFor(postFor(fb, { status: 'PUBLISHED', id: '789', publicUrl })), at(0))
    assert.equal(receipt.state, 'destination_unconfirmed')
  }
  const matching = 'https://facebook.com/permalink.php?story_fbid=789&id=123'
  assert.equal(readStageReceipts([fb], exportFor(postFor(fb, { status: 'PUBLISHED', id: '789', publicUrl: matching })), at(0))[0].state,
    'provider_reported_published')
  assert.throws(() => readStageReceipts([{ ...fb, expectedFacebookPageId: undefined }], exportFor(), at(0)))
})
