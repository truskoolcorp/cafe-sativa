import Anthropic from '@anthropic-ai/sdk'
import { generateConciergeResponse, type ConciergeMessage } from '@/lib/concierge/response-engine'
import { canonicalConciergeHost } from '@/lib/content/concierge-canon'
import { getUpcomingEvents } from '@/lib/events'
import { voiceProgrammingContext } from '@/lib/concierge/programming'
import { safeStageConversationText, stageConversationOutcome, STAGE_CONVERSATION_RULES } from './stage-conversation-policy'

const stageReplySchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['answer', 'review'] },
    reply: { type: 'string' },
  },
  required: ['action', 'reply'],
  additionalProperties: false,
}

export async function answerSoloStageQuestion(input: {
  host: 'ahnika' | 'laviche'
  persona: string
  question: string
  history: ConciergeMessage[]
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
  try {
    const result = await generateConciergeResponse({
      hostSystemPrompt: `${input.persona}\n\n${STAGE_CONVERSATION_RULES}`,
      canonicalContext: canonical.context,
      liveProgramming: voiceProgrammingContext(events),
      messages: [...input.history, { role: 'user', content: input.question }],
    }, request => provider.messages.create({
      ...request, max_tokens: 280,
      output_config: { format: { type: 'json_schema', schema: stageReplySchema } },
    }))
    const answer = stageConversationOutcome(result)
    if (answer.action === 'answer') return answer.reply
    console.info('[stage-conversation] completion_held', answer.action)
    return null
  } catch (error) {
    // Do not expose provider diagnostics, host instructions or private text.
    const status = error instanceof Anthropic.APIError ? error.status ?? null : null
    console.info('[stage-conversation] completion_unavailable', status)
    return null
  }
}
