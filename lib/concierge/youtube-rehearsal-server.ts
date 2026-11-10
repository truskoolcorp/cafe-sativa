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
  // Separate, explicitly provisioned repair run. Never reset/fall back to v1.
  reserveRehearsalV2?: (signal: AbortSignal) => Promise<boolean>
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

export function isYoutubeRehearsalRequest(value: unknown): value is { action: 'rehearsal' | 'rehearsal-v2' } {
  return object(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'action')
    && (value.action === 'rehearsal' || value.action === 'rehearsal-v2')
}

const STOP_REASONS = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal'] as const
type CompletionSummary = Readonly<{
  stopReason: typeof STOP_REASONS[number] | 'other' | 'missing'
  blockCount: number | null; textCharacters: number | null; inputTokens: number | null; outputTokens: number | null
}>
const EMPTY_COMPLETION: CompletionSummary = Object.freeze({ stopReason: 'missing', blockCount: null,
  textCharacters: null, inputTokens: null, outputTokens: null })
const count = (value: unknown): number | null => time(value) && value <= 1_000_000 ? value : null

/** A closed metadata-only projection, never a serialization of provider output.
 * Unknown strings, errors, nested fields, prompt/text, IDs and hashes cannot
 * cross this boundary. Malformed counts and throwing getters become null.
 */
export function summarizeYoutubeRehearsalCompletion(value: unknown): CompletionSummary {
  try {
    if (!object(value)) return EMPTY_COMPLETION
    const reason = value.stop_reason, content = value.content, usage = value.usage
    const stopReason = reason === undefined || reason === null ? 'missing'
      : STOP_REASONS.includes(reason as typeof STOP_REASONS[number]) ? reason as typeof STOP_REASONS[number] : 'other'
    const blockCount = Array.isArray(content) ? count(content.length) : null
    const textCharacters = Array.isArray(content) && content.length === 1 && object(content[0])
      && content[0].type === 'text' && typeof content[0].text === 'string' ? count(content[0].text.length) : null
    return Object.freeze({ stopReason, blockCount, textCharacters,
      inputTokens: object(usage) ? count(usage.input_tokens) : null,
      outputTokens: object(usage) ? count(usage.output_tokens) : null })
  } catch { return EMPTY_COMPLETION }
}

type GenerationOutcome = 'not_started' | 'passed' | 'stop_reason' | 'content_shape' | 'text_shape' | 'empty_text'
  | 'character_limit' | 'control_characters' | 'multiline_or_markup' | 'link_or_contact' | 'invalid_completion'
  | 'generation_failed' | 'generation_timeout' | 'generation_cancelled' | 'generation_expired'
const REVIEW_OUTCOMES = ['review_passed', 'review_denied', 'invalid_input', 'missing_transport', 'invalid_completion',
  'review_timeout', 'review_cancelled', 'review_failed', 'review_expired'] as const
const REVIEW_POLICIES = ['safe', 'private_data', 'instruction_disclosure', 'harassment', 'unsafe_content',
  'unsupported_facts', 'unauthorized_action', 'identity_misrepresentation', 'unsolicited_disclaimer', 'other_risk'] as const
type ReviewOutcome = typeof REVIEW_OUTCOMES[number] | 'not_started' | 'local_binding_rejected'
type Diagnostics = Readonly<{
  generation: Readonly<{ outcome: GenerationOutcome; completion: CompletionSummary }>
  review: Readonly<{ outcome: ReviewOutcome; policyCode: typeof REVIEW_POLICIES[number] | null; completion: CompletionSummary }>
}>

/** Classification is explanatory only. The unchanged shared parser remains the
 * sole content acceptance guard; no classification can turn a rejection into a
 * candidate, rewrite text, or weaken the 200-character hard cap.
 */
function generationOutcome(value: unknown, accepted: boolean): GenerationOutcome {
  if (accepted) return 'passed'
  try {
    if (!object(value)) return 'invalid_completion'
    if (value.stop_reason !== 'end_turn') return 'stop_reason'
    if (!Array.isArray(value.content) || value.content.length !== 1 || !object(value.content[0])) return 'content_shape'
    const block = value.content[0]
    if (block.type !== 'text' || typeof block.text !== 'string') return 'text_shape'
    if (!block.text.trim()) return 'empty_text'
    if (block.text.length > YOUTUBE_GENERATION_LIMITS.outputCharacters) return 'character_limit'
    if (/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(block.text)) return 'control_characters'
    if (/[\r\n<>]/u.test(block.text.trim())) return 'multiline_or_markup'
    if (/(?:https?:|www\.|@|\b[\w-]+\.(?:com|net|org|io|world)\b|\b\d[\d ().+-]{7,}\d\b)/iu.test(block.text.trim())) return 'link_or_contact'
    return 'invalid_completion'
  } catch { return 'invalid_completion' }
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
  generationMs: number | null; reviewMs: number | null; totalMs: number; diagnostics?: Diagnostics }>
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
      const repair = body.action === 'rehearsal-v2'
      const reserve = repair ? deps.reserveRehearsalV2 : deps.reserveRehearsal
      if (!reserve) return json([], 503)
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
        req.signal, reserve)
      if (reserved !== true) return json([], 429)
      fresh()

      // Parallel, bounded calls keep the full request below the route's 30s cap.
      // There are exactly two possible generation calls and two possible review
      // calls, all maxRetries:0. A failed generation has no replacement call.
      const run = async (fixture: typeof FIXTURES[number]): Promise<CaseResult> => {
        let startedAt = previous, generationStarted: number | null = null, reviewStarted: number | null = null
        let generationMs: number | null = null, reviewMs: number | null = null, passed = false
        let generation: GenerationOutcome = 'not_started', reviewOutcome: ReviewOutcome = 'not_started'
        let generationSummary = EMPTY_COMPLETION, reviewSummary = EMPTY_COMPLETION
        let policyCode: typeof REVIEW_POLICIES[number] | null = null
        const elapsed = (since: number) => {
          const at = clock()
          return time(at) && at >= since ? at - since : 0
        }
        try {
          startedAt = fresh()
          const source: Readonly<YoutubePublicObservation> = Object.freeze({ ...SYNTHETIC,
            messageId: `private-rehearsal-${repair ? 'v2-' : ''}${fixture.name}`, text: fixture.text,
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
          generation = 'generation_failed'
          const completion = await withYoutubeDeadline(YOUTUBE_GENERATION_LIMITS.generationTimeoutMs, req.signal,
            signal => deps.complete(request, { signal, maxRetries: 0, timeout: YOUTUBE_GENERATION_LIMITS.generationTimeoutMs }))
          generationMs = elapsed(generationStarted)
          generationSummary = summarizeYoutubeRehearsalCompletion(completion)
          const createdAt = sourceFresh(), text = parseYoutubeGenerationText(completion)
          generation = generationOutcome(completion, text !== null)
          if (!text) throw Error('unavailable')
          const draft: Readonly<YoutubeReviewDraft> = Object.freeze({ status: 'draft-needs-review', postingEnabled: false,
            sourceMessageId: source.messageId, authorChannelId: source.authorChannelId, text, createdAt,
            expiresAt: Math.min(createdAt + YOUTUBE_GENERATION_LIMITS.draftAgeMs,
              source.publishedAt + YOUTUBE_GENERATION_LIMITS.sourceAgeMs, context.expiresAt) })
          const input = Object.freeze({ source, draft, context })
          reviewStarted = sourceFresh()
          reviewOutcome = 'review_failed'
          const review = await reviewYoutubeResponse(input, async (request, options) => {
            sourceFresh()
            if (request.model !== CONCIERGE_MODEL || request.max_tokens !== YOUTUBE_GENERATION_LIMITS.reviewTokens
              || options.maxRetries !== 0) throw Error('unavailable')
            const completion = await deps.complete(request, options)
            if (!options.signal.aborted && !req.signal.aborted) reviewSummary = summarizeYoutubeRehearsalCompletion(completion)
            return completion
          }, { signal: req.signal, clock: sourceFresh })
          reviewMs = elapsed(reviewStarted)
          reviewOutcome = REVIEW_OUTCOMES.includes(review.reason as typeof REVIEW_OUTCOMES[number])
            ? review.reason as typeof REVIEW_OUTCOMES[number] : 'review_failed'
          if (review.status === 'reviewed' && REVIEW_POLICIES.includes(review.policyCode)) policyCode = review.policyCode
          passed = matchesYoutubeResponseReview(review, input, sourceFresh())
          if (!passed && reviewOutcome === 'review_passed') reviewOutcome = 'local_binding_rejected'
        } catch {
          // Deliberately discard provider errors, generated text and review proof.
          if (generation === 'generation_failed' && generationStarted !== null) {
            const at = clock()
            if (req.signal.aborted) generation = 'generation_cancelled'
            else if (!time(at) || at < previous || at >= context.expiresAt) generation = 'generation_expired'
            else if (at - generationStarted >= YOUTUBE_GENERATION_LIMITS.generationTimeoutMs) generation = 'generation_timeout'
          }
        }
        if (generationStarted !== null && generationMs === null) generationMs = elapsed(generationStarted)
        if (reviewStarted !== null && reviewMs === null) reviewMs = elapsed(reviewStarted)
        const diagnostics: Diagnostics = Object.freeze({
          generation: Object.freeze({ outcome: generation, completion: generationSummary }),
          review: Object.freeze({ outcome: reviewOutcome, policyCode, completion: reviewSummary }),
        })
        return Object.freeze({ case: fixture.name, passed, generationMs, reviewMs, totalMs: elapsed(startedAt),
          ...(repair ? { diagnostics } : {}) })
      }
      const cases = await Promise.all(FIXTURES.map(run))
      // Any cancellation, expiry or clock rollback after the provider completed
      // still suppresses even a passing result. The SQL claim remains consumed.
      fresh()
      return json(cases)
    } catch { return json([], 503) }
  }
}
