import { PROGRAMMING_FACT_RULES } from '@/lib/concierge/programming'

// Keep the dated ID: the short alias can have different account entitlement.
export const CONCIERGE_MODEL = 'claude-haiku-4-5-20251001' as const

export interface ConciergeMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ConciergeResponseInput {
  hostSystemPrompt: string
  canonicalContext: string
  liveProgramming: string
  messages: ConciergeMessage[]
}

/** Pure request builder. Callers supply only history authorized for their surface. */
export function buildConciergeModelRequest(input: ConciergeResponseInput) {
  return {
    model: CONCIERGE_MODEL,
    max_tokens: 512,
    system: `${input.hostSystemPrompt}\nCurrent approved GLYPH canonical context (use this for identity facts; it supersedes conflicting legacy descriptions):\n${input.canonicalContext}\nVerified website programming: ${input.liveProgramming}\n${PROGRAMMING_FACT_RULES}\nOnly announce dates and availability from the live programming records. An approved concept preview is not a booked performance or an operating physical venue.`,
    messages: input.messages,
  }
}

export type ConciergeCompletionTransport = (
  request: ReturnType<typeof buildConciergeModelRequest>
) => PromiseLike<{ content: Array<{ type: string; text?: string }> }>

/**
 * Model-only engine, with no credentials, persistence, sessions or memory lookup.
 * ASK retains its own FAQ, admission checks, history selection and error handling.
 * Public surfaces must supply public-only context, never private ASK guest history.
 * Provider failures propagate unchanged so each surface retains its error contract.
 */
export async function generateConciergeResponse(
  input: ConciergeResponseInput,
  createCompletion: ConciergeCompletionTransport,
): Promise<string> {
  const completion = await createCompletion(buildConciergeModelRequest(input))
  const replyText = completion.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
  return replyText || "Sorry, I didn't catch that — try me again?"
}
