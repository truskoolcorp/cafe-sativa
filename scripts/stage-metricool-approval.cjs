// Offline only: validate a pending brand export against an independently reviewed manifest.
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')

const brandId = '7605217'
const timezone = 'America/Chicago'
const id = /^\d{1,20}$/
const uuid = /^-?\d{1,20}$/
const sha256 = /^[a-f0-9]{64}$/
const asset = /^https:\/\/static\.metricool\.com\/planner\/\d{6}\/7605217-file-[\w.-]+$/
const handle = /^[a-z0-9._]{1,30}$/
const ref = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const matches = (re, value) => typeof value === 'string' && re.test(value)
const numeric = value => Number.isSafeInteger(value) ? String(value) : value

function utc(value) {
  if (!matches(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, value)) return NaN
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value.replace('Z', '.000Z') ? time : NaN
}

function local(time) {
  const p = Object.fromEntries(clock.formatToParts(time).map(({ type, value }) => [type, value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

function captureStageApprovals(manifest, snapshot, now = Date.now()) {
  const captured = utc(snapshot?.capturedAt)
  if (manifest?.brandId !== brandId || snapshot?.brandId !== brandId || !Array.isArray(manifest?.approvals) ||
      !manifest.approvals.length || !Array.isArray(snapshot?.data) || !(captured <= now) || !Number.isFinite(now)) {
    throw new Error('Reviewed manifest and timestamped Café Sativa export required')
  }
  const seenIds = new Set()
  const seenUuids = new Set()
  const audit = []
  const bindings = manifest.approvals.map((approval, index) => {
    const fail = detail => { throw new Error(`Approval ${index + 1}: ${detail}`) }
    const { postId, postUuid, network, caption, scheduledAt, mediaUrl, mediaSha256,
      approvedAt, approvalRef, expectedFacebookPageId, expectedInstagramUsername } = approval ?? {}
    if (!matches(id, postId) || !matches(uuid, postUuid) || seenIds.has(postId) || seenUuids.has(postUuid) ||
        !['facebook', 'instagram'].includes(network) || typeof caption !== 'string' || !caption.trim() ||
        !matches(asset, mediaUrl) || !matches(sha256, mediaSha256) || !matches(ref, approvalRef)) fail('invalid or duplicate binding')
    const scheduled = utc(scheduledAt)
    if (!(utc(approvedAt) <= captured && captured <= now && now < scheduled)) fail('approval and capture must precede publication')
    const dateTime = local(scheduled)
    if (local(scheduled - 3_600_000) === dateTime || local(scheduled + 3_600_000) === dateTime) fail('ambiguous Central time')
    if (network === 'facebook' ? !matches(id, expectedFacebookPageId) || snapshot.facebookPageId !== expectedFacebookPageId :
      !matches(handle, expectedInstagramUsername) || snapshot.instagramUsername !== expectedInstagramUsername) fail('account mismatch')
    const found = snapshot.data.filter(p => numeric(p?.id) === postId || p?.uuid === postUuid)
    if (found.length !== 1) fail('scheduled post is missing or ambiguous')
    const [post] = found
    const provider = post.providers?.[0]
    if (numeric(post.id) !== postId || post.uuid !== postUuid || post.text !== caption ||
        post.publicationDate?.dateTime !== dateTime || post.publicationDate?.timezone !== timezone ||
        post.autoPublish !== true || post.draft !== false || !Array.isArray(post.media) ||
        post.media.length !== 1 || post.media[0] !== mediaUrl || !Array.isArray(post.providers) ||
        post.providers.length !== 1 || provider?.network !== network || provider.status !== 'PENDING' ||
        provider.id || provider.publicUrl) fail('post is not an exact pending match')
    // A provider contradiction blocks capture; absent provider metadata never creates approval.
    if (post.postApprovalData != null && post.postApprovalData.approvalStatus !== 'approved') fail('provider approval is not approved')
    seenIds.add(postId)
    seenUuids.add(postUuid)
    audit.push({ postId, approvalRef, approvedAt, mediaSha256, account: network === 'facebook' ? expectedFacebookPageId : expectedInstagramUsername })
    return { postId, postUuid, network, captionSha256: createHash('sha256').update(caption).digest('hex'), scheduledAt, mediaUrl,
      ...(network === 'facebook' ? { expectedFacebookPageId } : {}) }
  })
  return { brandId, capturedAt: snapshot.capturedAt, bindings, audit }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/stage-metricool-approval.cjs reviewed-manifest.json pending-brand-export.json')
    const json = path => JSON.parse(readFileSync(path, 'utf8'))
    const result = captureStageApprovals(json(process.argv[2]), json(process.argv[3]))
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid JSON input' : error.message)
    process.exitCode = 1
  }
}

module.exports = { captureStageApprovals }
