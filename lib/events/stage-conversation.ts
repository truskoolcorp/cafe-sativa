import Anthropic from '@anthropic-ai/sdk'
import { generateConciergeResponse, type ConciergeMessage } from '@/lib/concierge/response-engine'
import { canonicalConciergeHost } from '@/lib/content/concierge-canon'
import { getUpcomingEvents } from '@/lib/events'
import { voiceProgrammingContext } from '@/lib/concierge/programming'
import { safeStageConversationText, stageConversationOutcome, STAGE_CONVERSATION_RULES, qualifyAhnikaPremiereTime } from './stage-conversation-policy'
import { AHNIKA_PREMIERE_SLUG, isCanonicalAhnikaPremiere } from './ahnika-premiere-window'

const stageReplySchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['answer', 'review'] },
    reply: { type: 'string' },
  },
  required: ['action', 'reply'],
  additionalProperties: false,
}

export async function answerStageQuestion(input: {
  host: 'ahnika' | 'laviche'
  persona: string
  question: string
  history: ConciergeMessage[]
  publicPremiere?: true
  dressRehearsal?: true
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.info('[stage-conversation] missing_provider_configuration')
    return null
  }
  if (!safeStageConversationText(input.question)) return null
  const [canonical, events] = await Promise.all([
    canonicalConciergeHost(input.host, AbortSignal.timeout(2500)).catch(() => null),
    getUpcomingEvents({ futureOnly: true, limit: 6 }).catch(() => []),
  ])
  if (!canonical) {
    console.info('[stage-conversation] approved_identity_unavailable')
    return null
  }
  const provider = new Anthropic({ apiKey, timeout: 12000, maxRetries: 0 })
  const knownPremiere = input.publicPremiere === true || events.some(event => event.slug === AHNIKA_PREMIERE_SLUG && isCanonicalAhnikaPremiere(event))
  const context = input.publicPremiere
    ? 'This is private attendee Q&A during the scheduled Stage premiere. For this verified room, Ahnika Merlot’s “Already Gone” starts Tuesday, December 1, 2026 at midnight Central. Watching is free and joining attendee chat requires signing in. The premiere and its live audience chat are distinct. Ahnika does not answer while she is on stage. Never claim to see or hear the audience or to have taken moderation actions.'
    : input.dressRehearsal
      ? 'This is the private November 24 timed Stage dress rehearsal. Doors open at 7:45 a.m. Central, and synchronized performance starts at 8:00 a.m. Central. This is not the December 1 public premiere. Ahnika does not answer during her set. Do not claim a moderator is present.'
      : 'This is a solo rehearsal. The current viewer can start, pause and rewind their own playback without affecting the public premiere or anyone else. No moderator is on duty for this test. The rehearsal is not the scheduled public premiere.'
  try {
    const result = await generateConciergeResponse({
      hostSystemPrompt: `${input.persona}\n\n${STAGE_CONVERSATION_RULES}\n${context}`,
      canonicalContext: canonical.context,
      liveProgramming: voiceProgrammingContext(events),
      messages: [...input.history, { role: 'user', content: input.question }],
    }, request => provider.messages.create({
      ...request, max_tokens: 280,
      output_config: { format: { type: 'json_schema', schema: stageReplySchema } },
    }))
    const answer = stageConversationOutcome(result)
    if (answer.action === 'answer') {
      const reply = knownPremiere ? qualifyAhnikaPremiereTime(answer.reply) : answer.reply
      return safeStageConversationText(reply) ? reply : null
    }
    console.info('[stage-conversation] completion_held', answer.action)
    return null
  } catch (error) {
    // Do not expose provider diagnostics, host instructions or private text.
    const status = error instanceof Anthropic.APIError ? error.status ?? null : null
    console.info('[stage-conversation] completion_unavailable', status)
    return null
  }
}
