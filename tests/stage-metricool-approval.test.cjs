const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createHash } = require('node:crypto')
const { captureStageApprovals } = require('../scripts/stage-metricool-approval.cjs')

function fixture() {
  const approval = { postId: '100', postUuid: '-901', network: 'facebook', caption: 'Virtual premiere — save your seat.',
    scheduledAt: '2026-11-30T23:00:00Z', mediaUrl: 'https://static.metricool.com/planner/202611/7605217-file-art.webp',
    mediaSha256: 'b'.repeat(64), expectedFacebookPageId: '1000', approvedAt: '2026-11-29T20:00:00Z', approvalRef: 'review:123' }
  const manifest = { brandId: '7605217', approvals: [approval] }
  const post = { id: 100, uuid: '-901', text: approval.caption, autoPublish: true, draft: false, media: [approval.mediaUrl],
    publicationDate: { timezone: 'America/Chicago', dateTime: '2026-11-30T17:00:00' }, providers: [{ network: 'facebook', status: 'PENDING' }],
    postApprovalData: { approvalStatus: 'approved' } }
  const snapshot = { brandId: '7605217', capturedAt: '2026-11-29T20:05:00Z', facebookPageId: '1000', instagramUsername: 'cafe_test', data: [post] }
  return { approval, post, manifest, snapshot, now: Date.parse('2026-11-29T20:06:00Z') }
}

test('exports compatible bindings and review references without echoing the caption or provider snapshot', () => {
  const { approval, manifest, snapshot, now } = fixture()
  const result = captureStageApprovals(manifest, snapshot, now)
  assert.deepEqual(result.bindings, [{ postId: '100', postUuid: '-901', network: 'facebook', mediaUrl: approval.mediaUrl,
    captionSha256: createHash('sha256').update(approval.caption).digest('hex'), scheduledAt: approval.scheduledAt, expectedFacebookPageId: '1000' }])
  assert.equal(result.audit[0].approvalRef, 'review:123')
  assert.equal(result.audit[0].mediaSha256, approval.mediaSha256)
  assert(!JSON.stringify(result).includes(approval.caption))
})

test('missing provider approval cannot replace a manifest; independent Instagram approval can stand on its own', () => {
  const { approval, post, manifest, snapshot, now } = fixture()
  approval.network = post.providers[0].network = 'instagram'
  approval.expectedInstagramUsername = 'cafe_test'
  delete post.postApprovalData
  assert.throws(() => captureStageApprovals(null, snapshot, now), /Reviewed manifest/)
  assert.equal(captureStageApprovals(manifest, snapshot, now).audit[0].account, 'cafe_test')
  post.postApprovalData = { approvalStatus: 'pending' }
  assert.throws(() => captureStageApprovals(manifest, snapshot, now), /provider approval/)
})

test('rejects published observations, corrections made after posting, and captures before review', () => {
  const { approval, post, manifest, snapshot, now } = fixture()
  post.providers[0].status = 'PUBLISHED'
  assert.throws(() => captureStageApprovals(manifest, snapshot, now), /exact pending/)
  post.providers[0].status = 'PENDING'
  assert.throws(() => captureStageApprovals(manifest, snapshot, Date.parse(approval.scheduledAt)), /precede publication/)
  snapshot.capturedAt = '2026-11-29T19:55:00Z'
  assert.throws(() => captureStageApprovals(manifest, snapshot, now), /precede publication/)
})

test('fails closed on cross-account, modified content, date or identity collisions', () => {
  const { approval, post, manifest, snapshot, now } = fixture()
  snapshot.facebookPageId = '1001'
  assert.throws(() => captureStageApprovals(manifest, snapshot, now), /account mismatch/)
  snapshot.facebookPageId = '1000'
  post.text += ' '
  assert.throws(() => captureStageApprovals(manifest, snapshot, now), /exact pending/)
  post.text = approval.caption
  approval.scheduledAt = '2026-11-31T23:00:00Z'
  assert.throws(() => captureStageApprovals(manifest, snapshot, now), /precede publication/)
  approval.scheduledAt = '2026-11-30T23:00:00Z'
  snapshot.data.push({ ...post, id: 101 })
  assert.throws(() => captureStageApprovals(manifest, snapshot, now), /ambiguous/)
})

test('rejects the repeated Chicago hour that the provider local timestamp cannot distinguish', () => {
  const { approval, post, manifest, snapshot } = fixture()
  approval.approvedAt = '2026-10-31T20:00:00Z'
  snapshot.capturedAt = '2026-10-31T20:05:00Z'
  approval.scheduledAt = '2026-11-01T06:30:00Z'
  post.publicationDate.dateTime = '2026-11-01T01:30:00'
  assert.throws(() => captureStageApprovals(manifest, snapshot, Date.parse('2026-10-31T20:06:00Z')), /ambiguous Central time/)
})
