import { HIT_EM_PREMIERE } from '@/lib/events/hit-em-premiere'
import type { YoutubePublicContext } from '@/lib/concierge/youtube-draft-bridge'

/**
 * Reviewed public projection for this one premiere, not a canonical-record reader.
 * Identity/style are the public Laviche persona in concierge/personas.ts and the
 * public ASK host card. Event facts are the published Hit Em premiere page and
 * events/hit-em-premiere.ts. This is not the full current canonical biography.
 * Deliberately do not import the full persona, event loader, ASK or private data.
 */
export const YOUTUBE_PUBLIC_HOST_FACTS = Object.freeze({
  id: 'laviche',
  displayName: 'Laviche Cárdenas',
  role: "Maître d'",
  venue: 'Café Sativa',
  identity: 'Virtual AI host, not physically present.',
  biography: "Café Sativa's maître d'. She runs the virtual venue floor and helps guests with its rooms, events, style, and Concrete Rose.",
  characterBackground: 'Her established persona draws on art openings, late dinners, and travel. No further life-history facts are provided.',
  brandIdentity: 'Concrete Rose is her style and fashion lane, a streetwear line in the Tru Skool family.',
  style: 'Warm, knowing, tasteful, grounded, with soft confidence.',
  conversationStyle: 'Read the room before speaking. Answer directly, with taste. Stay natural and in character, without invented guest history or personal experiences.',
  identityPolicy: 'Speak as Laviche in first person. Do not introduce routine "as an AI" or "as a bot" disclaimers. If directly asked, be truthful that you are a virtual AI host, not a human.',
  surface: 'Public YouTube chat. Replies here are text, not voice.',
})

export interface YoutubePublicEventFacts {
  readonly eventId: string
  readonly title: string
  readonly startsAtUtc: string
  readonly startsAtLocal: string
  readonly timeZone: string
  readonly ticketPriceCents: 0
  readonly access: 'free'
  readonly admission: string
  readonly chatPolicy: string
  readonly playbackPolicy: string
  readonly sessionPolicy: string
}

// Explicit fields only: no arbitrary descriptions, links, contacts, media,
// attendees, venue menus, artist credits, duration or presumed host attendance.
export const YOUTUBE_PUBLIC_EVENT_FACTS: Readonly<YoutubePublicEventFacts> = Object.freeze({
  eventId: HIT_EM_PREMIERE.eventId,
  title: HIT_EM_PREMIERE.title,
  startsAtUtc: HIT_EM_PREMIERE.startsAt,
  startsAtLocal: 'Wednesday, November 11, 2026 at 12:00 AM midnight CST (Dallas, America/Chicago).',
  timeZone: HIT_EM_PREMIERE.timeZone,
  ticketPriceCents: 0,
  access: 'free',
  admission: 'Free public gathering. No Café Sativa account, membership, ticket, or payment is required.',
  chatPolicy: 'The shared premiere chat is on YouTube. YouTube sign-in is required to post. ASK host conversations are separate.',
  playbackPolicy: 'YouTube controls when playback begins and whether the video is available.',
  sessionPolicy: 'No separate Zoom room or promised live-host session.',
})

export const YOUTUBE_PUBLIC_CONTEXT_MAX_AGE_MS = 60_000

// Local draft operating window only. Its end is NOT the event's end time or
// video duration and is never included in facts sent to the response engine.
export const YOUTUBE_PUBLIC_CONTEXT_WINDOW = Object.freeze({
  startsAt: Date.parse(HIT_EM_PREMIERE.startsAt),
  endsAt: Date.parse(HIT_EM_PREMIERE.startsAt) + 30 * 60_000,
})

/**
 * A future trusted reader must obtain these exact public listing facts and
 * timestamps. This pure projection cannot authenticate the caller or prove a
 * network read happened. A matching object is not authorization to run or post.
 * Do not construct observations from private records or cached static constants.
 */
export interface YoutubePublicEventObservation {
  sourcePath: string
  eventId: string
  videoId: string
  title: string
  startsAt: string
  timeZone: string
  ticketPriceCents: number
  status: 'scheduled' | 'live' | 'ended' | 'canceled'
  observedAt: number
  expiresAt: number
}

/** No I/O, current-time inference, free-text projection, or freshness renewal. */
export function buildYoutubePublicContext(value: unknown, now: number): Readonly<YoutubePublicContext> | null {
  const window = YOUTUBE_PUBLIC_CONTEXT_WINDOW
  if (!Number.isSafeInteger(now) || now < window.startsAt || now >= window.endsAt
    || !value || typeof value !== 'object' || Array.isArray(value)) return null

  try {
    const row = value as Record<string, unknown>
    // Read only the allowlist once. Extra fields (including getters containing
    // private data) are never traversed, spread, retained or serialized.
    const event = {
      sourcePath: row.sourcePath, eventId: row.eventId, videoId: row.videoId,
      title: row.title, startsAt: row.startsAt, timeZone: row.timeZone,
      ticketPriceCents: row.ticketPriceCents, status: row.status,
      observedAt: row.observedAt, expiresAt: row.expiresAt,
    }
    if (event.sourcePath !== HIT_EM_PREMIERE.path || event.eventId !== HIT_EM_PREMIERE.eventId
      || event.videoId !== HIT_EM_PREMIERE.videoId || event.title !== HIT_EM_PREMIERE.title
      || event.startsAt !== HIT_EM_PREMIERE.startsAt || event.timeZone !== HIT_EM_PREMIERE.timeZone
      || event.ticketPriceCents !== 0 || (event.status !== 'scheduled' && event.status !== 'live')
      || typeof event.observedAt !== 'number' || !Number.isSafeInteger(event.observedAt)
      || typeof event.expiresAt !== 'number' || !Number.isSafeInteger(event.expiresAt)
      || event.observedAt > now || now - event.observedAt >= YOUTUBE_PUBLIC_CONTEXT_MAX_AGE_MS
      || event.expiresAt <= now || event.expiresAt > event.observedAt + YOUTUBE_PUBLIC_CONTEXT_MAX_AGE_MS) return null

    return Object.freeze({
      scope: 'approved-public-host-context',
      eventId: HIT_EM_PREMIERE.eventId,
      videoId: HIT_EM_PREMIERE.videoId,
      // Preserve source freshness; repeated construction cannot renew it.
      observedAt: event.observedAt,
      expiresAt: Math.min(event.expiresAt, window.endsAt),
      publicCanonicalContext: JSON.stringify(YOUTUBE_PUBLIC_HOST_FACTS),
      publicProgramming: JSON.stringify({ events: [{ ...YOUTUBE_PUBLIC_EVENT_FACTS, status: event.status }] }),
    })
  } catch {
    // Malformed/proxied input cannot turn this projection into an error leak.
    return null
  }
}
