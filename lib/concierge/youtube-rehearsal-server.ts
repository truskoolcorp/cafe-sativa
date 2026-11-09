import { HIT_EM_PREMIERE } from '@/lib/events/hit-em-premiere'
import { CONCIERGE_MODEL } from '@/lib/concierge/response-engine'
import type { YoutubePublicContext, YoutubePublicObservation, YoutubeReviewDraft } from '@/lib/concierge/youtube-draft-bridge'
import {
  YOUTUBE_PUBLIC_HOST_FACTS, YOUTUBE_PUBLIC_EVENT_FACTS,
  YOUTUBE_PUBLIC_CONTEXT_MAX_AGE_MS, YOUTUBE_PUBLIC_CONTEXT_WINDOW,
} from '@/lib/concierge/youtube-public-context'
import {
  YOUTUBE_GENERATION_LIMITS, YOUTUBE_GENERATION_SURFACE_RULES, parseYoutubeGenerationText,
  withYoutubeDeadline, youtubeBearerMatches, type YoutubeGenerationDependencies,
  type YoutubeGenerationModelRequest,
} from '@/lib/concierge/youtube-generation-server'
import { matchesYoutubeResponseReview, reviewYoutubeResponse } from '@/lib/concierge/youtube-response-review'

/** Private provider rehearsal, NOT a source of live-chat candidates. No I/O at
 * import/factory time. The caller can request only the two fixed fixtures below.
 * Both are permanently consumed by one separate, zero-argument SQL reservation
 * BEFORE any provider call. Crashes, cancellation, denial and uncertainty never
 * refund this reservation. Nothing generated is returned, persisted or posted.
 */
export interface YoutubeRehearsalDependencies extends Pick<YoutubeGenerationDependencies,
  'token' | 'configured' | 'clock' | 'readPublicEvent' | 'complete'> {
  reserveRehearsal: (signal: AbortSignal) => Promise<boolean>
}

const FIXTURES = Object.freeze([
  Object.freeze({ name: 'conversation', text: 'I love discovering music with people. What makes a good listening night for you?' }),
  Object.freeze({ name: 'public-event', text: 'When does the Hit Em Release Party start, and do I need a ticket?' }),
] as const)

// These identifiers deliberately CANNOT match the live event, video, chat,
// authenticated host or any real public source. Even an internal review is
// bound to this synthetic namespace, not an eligible live-chat observation.
const SYNTHETIC = Object.freeze({ eventId: 'private-rehearsal-only', videoId: 'private-rehearsal-video',
  liveChatId: 'private_rehearsal_not_a_chat', authenticatedChannelId: 'UC0000000000000000000000',
  authorChannelId: 'UC1111111111111111111111' })

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function isYoutubeRehearsalRequest(value: unknown): value is { action: 'rehearsal' } {
  return object(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'action') && value.action === 'rehearsal'
}

/** A separate rehearsal projection uses genuine current timestamps. Never fake
 * a live-window clock or weaken buildYoutubePublicContext's live-only checks.
 * Read only exact public listing facts, and only while it remains scheduled.
 */
function rehearsalContext(value: unknown, now: number): Readonly<YoutubePublicContext> | null {
  if (!time(now) || now >= YOUTUBE_PUBLIC_CONTEXT_WINDOW.endsAt || !object(value)) return null
  try {
    const event = { sourcePath: value.sourcePath, eventId: value.eventId, videoId: value.videoId,
      title: value.title, startsAt: value.startsAt, timeZone: value.timeZone,
      ticketPriceCents: value.ticketPriceCents, status: value.status,
      observedAt: value.observedAt, expiresAt: value.expiresAt }
    if (event.sourcePath !== HIT_EM_PREMIERE.path || event.eventId !== HIT_EM_PREMIERE.eventId
      || event.videoId !== HIT_EM_PREMIERE.videoId || event.title !== HIT_EM_PREMIERE.title
      || event.startsAt !== HIT_EM_PREMIERE.startsAt || event.timeZone !== HIT_EM_PREMIERE.timeZone
      || event.ticketPriceCents !== 0 || event.status !== 'scheduled'
      || !time(event.observedAt) || !time(event.expiresAt) || event.observedAt > now
      || now - event.observedAt >= YOUTUBE_PUBLIC_CONTEXT_MAX_AGE_MS || event.expiresAt <= now
      || event.expiresAt > event.observedAt + YOUTUBE_PUBLIC_CONTEXT_MAX_AGE_MS) return null
    return Object.freeze({ scope: 'approved-public-host-context', eventId: SYNTHETIC.eventId,
      videoId: SYNTHETIC.videoId, observedAt: event.observedAt,
      expiresAt: Math.min(event.expiresAt, YOUTUBE_PUBLIC_CONTEXT_WINDOW.endsAt),
      publicCanonicalContext: JSON.stringify(YOUTUBE_PUBLIC_HOST_FACTS),
      publicProgramming: JSON.stringify({ events: [{ ...YOUTUBE_PUBLIC_EVENT_FACTS, status: 'scheduled' }] }),
    })
  } catch { return null }
}

type CaseResult = Readonly<{ case: typeof FIXTURES[number]['name']; passed: boolean;
  generationMs: number | null; reviewMs: number | null; totalMs: number }>
const json = (cases: CaseResult[], status = 200) => new Response(JSON.stringify({ cases }), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } })

/** The SAME authenticated endpoint dispatches here after bounded body parsing.
 * Authentication is repeated defensively; no alternate URL or public rehearsal
 * route exists. No source/text/time/model/budget parameters are accepted.
 */
export function createYoutubeRehearsalHandler(deps: YoutubeRehearsalDependencies) {
  const clock = deps.clock ?? Date.now
  return async (req: Request, body: unknown): Promise<Response> => {
    try {
      if (!deps.configured()) return json([], 503)
      if (!youtubeBearerMatches(req.headers.get('authorization'), deps.token())) return json([], 401)
      const url = new URL(req.url)
      if (req.method !== 'POST' || url.pathname !== '/api/concierge/youtube' || url.search
        || req.headers.has('origin') || req.headers.has('cookie') || !isYoutubeRehearsalRequest(body)) return json([], 400)
      let previous = clock()
      const now = () => {
        const at = clock()
        if (!time(at) || at < previous || at >= YOUTUBE_PUBLIC_CONTEXT_WINDOW.endsAt || req.signal.aborted) throw Error('unavailable')
        previous = at; return at
      }
      now()
      const observation = await withYoutubeDeadline(YOUTUBE_GENERATION_LIMITS.dependencyTimeoutMs,
        req.signal, deps.readPublicEvent)
      const context = rehearsalContext(observation, now())
      if (!context) return json([], 503)
      const fresh = () => {
        const at = now()
        if (at >= context.expiresAt) throw Error('unavailable')
        return at
      }
      fresh()
      const reserved = await withYoutubeDeadline(YOUTUBE_GENERATION_LIMITS.dependencyTimeoutMs,
        req.signal, deps.reserveRehearsal)
      if (reserved !== true) return json([], 429)
      fresh()

      // Parallel, bounded calls keep the full request below the route's 30s cap.
      // There are exactly two possible generation calls and two possible review
      // calls, all maxRetries:0. A failed generation has no replacement call.
      const run = async (fixture: typeof FIXTURES[number]): Promise<CaseResult> => {
        let startedAt = previous, generationStarted: number | null = null, reviewStarted: number | null = null
        let generationMs: number | null = null, reviewMs: number | null = null, passed = false
        const elapsed = (since: number) => {
          const at = clock()
          return time(at) && at >= since ? at - since : 0
        }
        try {
          startedAt = fresh()
          const source: Readonly<YoutubePublicObservation> = Object.freeze({ ...SYNTHETIC,
            messageId: `private-rehearsal-${fixture.name}`, text: fixture.text,
            publishedAt: startedAt, observedAt: startedAt })
          const sourceFresh = () => {
            const at = fresh()
            if (at - source.publishedAt >= YOUTUBE_GENERATION_LIMITS.sourceAgeMs) throw Error('unavailable')
            return at
          }
          const request: YoutubeGenerationModelRequest = {
            model: CONCIERGE_MODEL, max_tokens: YOUTUBE_GENERATION_LIMITS.generationTokens,
            system: `${YOUTUBE_GENERATION_SURFACE_RULES}\nReviewed public host facts: ${context.publicCanonicalContext}\nVerified public event facts: ${context.publicProgramming}`,
            messages: [{ role: 'user', content: JSON.stringify({
              privateRehearsal: true, syntheticFixture: fixture.name, publicHistory: [],
              currentGuest: 'synthetic-guest', currentGuestMessage: fixture.text,
            }) }],
          }
          generationStarted = sourceFresh()
          const completion = await withYoutubeDeadline(YOUTUBE_GENERATION_LIMITS.generationTimeoutMs, req.signal,
            signal => deps.complete(request, { signal, maxRetries: 0, timeout: YOUTUBE_GENERATION_LIMITS.generationTimeoutMs }))
          generationMs = elapsed(generationStarted)
          const createdAt = sourceFresh(), text = parseYoutubeGenerationText(completion)
          if (!text) throw Error('unavailable')
          const draft: Readonly<YoutubeReviewDraft> = Object.freeze({ status: 'draft-needs-review', postingEnabled: false,
            sourceMessageId: source.messageId, authorChannelId: source.authorChannelId, text, createdAt,
            expiresAt: Math.min(createdAt + YOUTUBE_GENERATION_LIMITS.draftAgeMs,
              source.publishedAt + YOUTUBE_GENERATION_LIMITS.sourceAgeMs, context.expiresAt) })
          const input = Object.freeze({ source, draft, context })
          reviewStarted = sourceFresh()
          const review = await reviewYoutubeResponse(input, (request, options) => {
            sourceFresh()
            if (request.model !== CONCIERGE_MODEL || request.max_tokens !== YOUTUBE_GENERATION_LIMITS.reviewTokens
              || options.maxRetries !== 0) throw Error('unavailable')
            return deps.complete(request, options)
          }, { signal: req.signal, clock: sourceFresh })
          reviewMs = elapsed(reviewStarted)
          passed = matchesYoutubeResponseReview(review, input, sourceFresh())
        } catch {
          // Deliberately discard provider errors, generated text and review proof.
        }
        if (generationStarted !== null && generationMs === null) generationMs = elapsed(generationStarted)
        if (reviewStarted !== null && reviewMs === null) reviewMs = elapsed(reviewStarted)
        return Object.freeze({ case: fixture.name, passed, generationMs, reviewMs, totalMs: elapsed(startedAt) })
      }
      const cases = await Promise.all(FIXTURES.map(run))
      // Any cancellation, expiry or clock rollback after the provider completed
      // still suppresses even a passing result. The SQL claim remains consumed.
      fresh()
      return json(cases)
    } catch { return json([], 503) }
  }
}
