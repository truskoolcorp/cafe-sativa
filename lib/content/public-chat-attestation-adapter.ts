import { HIT_EM_PREMIERE as EVENT } from '../events/hit-em-premiere'
import { validatePlainJson, type Providers } from './public-chat-attestation'

type Reads = {
  // Only inject the existing fixed, authorized server functions with these names.
  // Never accept a URL, caller-produced JSON, cached fixture or alternative reader.
  liveGlyphCharacters: () => Promise<unknown>
  loadHitEmPremiere: () => Promise<unknown>
  now: () => number
}
const TTL = 60_000
function time(x: number) {
  if (!Number.isSafeInteger(x) || x < 0 || x > 8.64e15) throw Error('unavailable')
  return x
}
function record(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('unavailable')
  return x as Record<string, unknown>
}
function exact(x: Record<string, unknown>, keys: string[]) {
  if (Object.keys(x).sort().join('|') !== keys.sort().join('|')) throw Error('unavailable')
}

/** Dormant adapter factory: constructing it performs no reads. No runtime wiring.
 * Review-approved public-page policy, not database video/visibility columns.
 * verifiedAt is registry observation completion, NOT profile prose provenance.
 */
export function createTrustedPublicChatProviders(reads: Reads): Providers {
  let previous: number | undefined
  const now = () => {
    const t = time(reads.now())
    if (previous !== undefined && t < previous) throw Error('unavailable')
    previous = t
    return t
  }
  return {
    now,
    async readCanon() {
      try {
        const started = now()
        const raw = await reads.liveGlyphCharacters()
        const completed = now()
        validatePlainJson(raw)
        const source = record(raw)
        exact(source, ['verifiedAt', 'source', 'studioUrl', 'live', 'characters'])
        if (source.live !== true || source.source !== 'GLYPH live canonical registry' || source.studioUrl !== 'https://studio.truskool.net/' || !Array.isArray(source.characters) || source.characters.length > 100 || typeof source.verifiedAt !== 'string') throw Error('unavailable')
        const observed = Date.parse(source.verifiedAt)
        if (!Number.isSafeInteger(observed) || new Date(observed).toISOString() !== source.verifiedAt || observed < started || observed > completed || completed - started >= TTL) throw Error('unavailable')
        // Pin the entire Café-enriched row, including portrait_url, without exposing it.
        // Use request start conservatively: timestamp is completion, not snapshot start.
        return { liveRead: true, originObservedAt: started, value: { live: true, characters: source.characters } }
      } catch { throw Error('unavailable') }
    },
    async readEvent() {
      try {
        const started = now()
        const raw = await reads.loadHitEmPremiere()
        const completed = now()
        validatePlainJson(raw)
        const event = record(raw)
        exact(event, ['state', 'status', 'title', 'description', 'startsAt'])
        if (completed - started >= TTL || event.state !== 'ready' || typeof event.status !== 'string' || !['scheduled', 'live'].includes(event.status) || event.title !== EVENT.title || event.startsAt !== EVENT.startsAt || typeof event.description !== 'string' || event.description.length > 10000) throw Error('unavailable')
        // The existing loader binds ID/slug/free price through my_events_v and
        // publicHitEmPremiere. Public/video are this reviewed page policy's constants.
        return { liveRead: true, originObservedAt: started, value: {
          id: EVENT.eventId, slug: EVENT.slug, title: EVENT.title,
          starts_at: EVENT.startsAt, video_id: EVENT.videoId,
          visibility: 'public', ticket_price_cents: 0, status: event.status,
        } }
      } catch { throw Error('unavailable') }
    },
  }
}
