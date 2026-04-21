import { createAdminClient } from '@/lib/supabase/admin'
import type { Tier } from './rate-limit'

/**
 * Days of history we look back when building prompt context. Matches
 * shared/venue-config.json cross_surface_memory.
 *
 * The "not creepy" rule from the architecture doc: we HAVE the memory,
 * but we only surface it when the current conversation is relevant to
 * what was said before. This helper just retrieves the messages —
 * whether the host agent brings them up is a prompt-construction
 * decision in the system prompt. We trust the model.
 */
const MEMORY_WINDOW_DAYS: Record<Tier, number> = {
  anonymous: 0, // session only — in-conversation context, no retrieval
  explorer: 0, // session only
  regular: 90,
  vip: 365,
}

/**
 * How many recent messages to include in prompt context. We cap this
 * hard — a VIP with 365 days of history could have thousands of
 * messages, and stuffing all of them into every prompt is wasteful
 * AND actively degrades quality. The last 20 messages (10 turns) is
 * usually plenty for context without diluting the system prompt.
 */
const MAX_CONTEXT_MESSAGES = 20

export type ContextMessage = {
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

/**
 * Pull prior messages from this user's conversations with this host.
 * Returns them oldest-first (ready to stream into the Messages API).
 *
 * For anonymous and Explorer tiers we return [] — context will come
 * from the current conversation only, which the caller handles.
 */
export async function getMemoryContext(params: {
  userId: string | null
  hostAgent: string
  tier: Tier
}): Promise<ContextMessage[]> {
  const { userId, hostAgent, tier } = params

  if (!userId) return []

  const windowDays = MEMORY_WINDOW_DAYS[tier]
  if (windowDays === 0) return []

  const admin = createAdminClient()
  const since = new Date(Date.now() - windowDays * 86400 * 1000).toISOString()

  const { data, error } = await admin
    .from('host_messages')
    .select('role, content, created_at, host_conversations!inner(user_id, host_agent)')
    .eq('host_conversations.user_id', userId)
    .eq('host_conversations.host_agent', hostAgent)
    .gte('created_at', since)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(MAX_CONTEXT_MESSAGES)

  if (error) {
    console.error('[concierge-memory] retrieval failed', error)
    return []
  }

  if (!data) return []

  // Reverse to chronological (we queried desc to apply LIMIT on the
  // NEWEST N rows, not the oldest).
  return data.reverse().map((row: any) => ({
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  }))
}
