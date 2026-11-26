// Read-only rehearsal/canary evidence: no API credentials, network, or database writes.
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')

const networks = new Set(['facebook', 'instagram'])
const zone = 'America/Chicago'
const decimal = /^\d{1,20}$/
const uuid = /^-?\d{1,20}$/
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex')
const numericString = value => typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : ''

function localTime(time) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(time)
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

function parsePublicUrl(input, network) {
  if (typeof input !== 'string') return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null
    if (network === 'facebook' && ['facebook.com', 'www.facebook.com'].includes(url.hostname)) {
      const path = /^\/(?:reel\/\d+|[^/]+\/posts\/[\w-]+)\/?$/.test(url.pathname)
      const permalink = ['/permalink.php', '/story.php'].includes(url.pathname) &&
        /^\w+$/.test(url.searchParams.get('story_fbid') ?? '') && decimal.test(url.searchParams.get('id') ?? '')
      if (path || permalink) {
        const page = /^\/(\d+)\/posts\//.exec(url.pathname)?.[1]
        const permalinkPages = permalink ? url.searchParams.getAll('id') : []
        return { href: url.href, pageId: page ?? (permalinkPages.length === 1 ? permalinkPages[0] : null) }
      }
    }
    if (network === 'instagram' && ['instagram.com', 'www.instagram.com'].includes(url.hostname) &&
        /^\/(?:p|reel)\/[\w-]+\/?$/.test(url.pathname)) return { href: url.href }
  } catch { /* An unfamiliar link is not evidence. */ }
  return null
}

function readStageReceipts(bindings, observations, now = Date.now()) {
  // Supply bindings from a trusted, previously recorded approval/scheduling receipt,
  // not values copied from the publication result being evaluated.
  if (!Array.isArray(bindings) || bindings.length === 0 || !Array.isArray(observations?.data) ||
      observations.brandId !== '7605217' || !Number.isFinite(now)) throw new Error('Café Sativa bindings and export required')
  const seen = new Set()
  return bindings.map(binding => {
    const { postId, postUuid, network, captionSha256, scheduledAt, mediaUrl, expectedFacebookPageId } = binding
    const scheduled = typeof scheduledAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(scheduledAt)
      ? Date.parse(scheduledAt) : NaN
    if (typeof postId !== 'string' || !decimal.test(postId) || typeof postUuid !== 'string' || !uuid.test(postUuid) ||
        !networks.has(network) || !/^[a-f\d]{64}$/.test(captionSha256) || !Number.isFinite(scheduled) ||
        (network === 'facebook' && (typeof expectedFacebookPageId !== 'string' || !decimal.test(expectedFacebookPageId))) ||
        typeof mediaUrl !== 'string' || !/^https:\/\/static\.metricool\.com\/planner\/\d{6}\/7605217-file-[\w.-]+$/.test(mediaUrl) ||
        seen.has(postId) || seen.has(postUuid)) throw new Error('Invalid or duplicate approved Stage post binding')
    seen.add(postId)
    seen.add(postUuid)
    const expired = now >= scheduled + 30 * 60_000
    const result = state => ({ postId, network, scheduledAt, state })
    // A match on either identifier is enough to flag collisions or mutated identities.
    const matches = observations.data.filter(post => numericString(post?.id) === postId || post?.uuid === postUuid)
    if (!matches.length) return result(expired ? 'overdue_unconfirmed' : 'not_observed')
    if (matches.length !== 1) return result('ambiguous')
    const [post] = matches
    if (numericString(post.id) !== postId || post.uuid !== postUuid || typeof post.text !== 'string' ||
        digest(post.text) !== captionSha256 || post.publicationDate?.timezone !== zone ||
        post.publicationDate?.dateTime !== localTime(scheduled) || post.autoPublish !== true || post.draft !== false ||
        !Array.isArray(post.media) || post.media.length !== 1 || post.media[0] !== mediaUrl ||
        !Array.isArray(post.providers) || post.providers.length !== 1 || post.providers[0]?.network !== network) return result('binding_mismatch')
    const [provider] = post.providers
    if (provider.status === 'PENDING') return result(expired ? 'overdue_unconfirmed' : 'scheduled')
    if (provider.status !== 'PUBLISHED') return result('provider_unconfirmed')
    const link = parsePublicUrl(provider.publicUrl, network)
    if (now < scheduled || typeof provider.id !== 'string' || !provider.id.trim() || !link) return result('provider_unconfirmed')
    const evidence = { providerId: provider.id, publicUrl: link.href, publiclyVerified: false }
    if (network === 'facebook' && link.pageId !== expectedFacebookPageId) {
      return { ...result(link.pageId ? 'destination_mismatch' : 'destination_unconfirmed'), ...evidence,
        expectedFacebookPageId, permalinkPageId: link.pageId }
    }
    return { ...result('provider_reported_published'), ...evidence }
  })
}

if (require.main === module) {
  try {
    const [, , bindingPath, observationPath] = process.argv
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/stage-metricool-receipt.cjs approved-bindings.json brand-scoped-export.json')
    const json = path => JSON.parse(readFileSync(path, 'utf8'))
    process.stdout.write(JSON.stringify(readStageReceipts(json(bindingPath), json(observationPath)), null, 2) + '\n')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { readStageReceipts }
