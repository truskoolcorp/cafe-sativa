import 'server-only'
import { HIT_EM_PREMIERE as EVENT } from '../events/hit-em-premiere'

// Noncredential, private server configuration. Never NEXT_PUBLIC_* or request input.
// This file contains no real pin, reply approval, default interval or activation.
const SHA = /^[a-f0-9]{64}$/
const END = Date.parse(EVENT.startsAt) + 30 * 60_000
const KEYS = ['version', 'eventId', 'videoId', 'startsAt', 'privateCanonicalSha256', 'publicReplyArtifactSha256', 'validFrom', 'validUntil'].sort().join('|')

/** Decode only compact JSON.stringify output. Round-trip equality deliberately
 * rejects duplicate/escaped-alias keys, noncanonical numbers and extra whitespace.
 * Provisioning this value requires separate authorization; parsing proves no approval.
 * The interval is read-only verification validity, never a posting authorization.
 */
export function parsePrivateReadinessConfig(raw: unknown) {
  try {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null
    const c = JSON.parse(raw)
    if (!c || Array.isArray(c) || typeof c !== 'object' || JSON.stringify(c) !== raw || Object.keys(c).sort().join('|') !== KEYS) return null
    if (c.version !== 1 || c.eventId !== EVENT.eventId || c.videoId !== EVENT.videoId || c.startsAt !== EVENT.startsAt) return null
    if (typeof c.privateCanonicalSha256 !== 'string' || !SHA.test(c.privateCanonicalSha256) || typeof c.publicReplyArtifactSha256 !== 'string' || !SHA.test(c.publicReplyArtifactSha256) || c.privateCanonicalSha256 === c.publicReplyArtifactSha256) return null
    if (!Number.isSafeInteger(c.validFrom) || !Number.isSafeInteger(c.validUntil) || c.validFrom < 0 || c.validFrom >= c.validUntil || c.validFrom > Date.parse(EVENT.startsAt) || c.validUntil !== END || c.validUntil - c.validFrom > 48 * 60 * 60_000) return null
    return Object.freeze({ version: 1, privateCanonicalSha256: c.privateCanonicalSha256, publicReplyArtifactSha256: c.publicReplyArtifactSha256, validFrom: c.validFrom, validUntil: c.validUntil })
  } catch { return null }
}
