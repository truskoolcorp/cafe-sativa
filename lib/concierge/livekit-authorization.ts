import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { getHost, type HostId } from '@/lib/concierge/personas'
import type { Tier } from '@/lib/concierge/rate-limit'

export type AuthorizedVoice = {
  host: HostId
  userId: string | null
  sessionId: string | null
  tier: Tier
  conversationId: string
}

// Fail-closed usage limits for LiveKit. Never use the legacy text-chat
// limiter here because its database-error path deliberately fails open.
const LIMITS: Record<Tier, { max: number; seconds: number }> = {
  anonymous: { max: 10, seconds: 3600 },
  explorer: { max: 50, seconds: 86400 },
  regular: { max: 200, seconds: 86400 },
  vip: { max: 1000, seconds: 86400 },
}
export async function checkVoiceQuota(userId: string | null, sessionId: string | null, tier: Tier) {
  const admin = createAdminClient()
  const { max, seconds } = LIMITS[tier]
  const since = new Date(Date.now() - seconds * 1000).toISOString()
  let q = admin.from('host_messages')
    .select('id, host_conversations!inner(user_id, session_id)', { count: 'exact', head: true })
    .eq('role', 'user').gte('created_at', since)
  if (userId) q = q.eq('host_conversations.user_id', userId)
  else if (sessionId) q = q.eq('host_conversations.session_id', sessionId)
  else throw new Error('No voice session identity')
  const { count, error } = await q
  if (error || count === null) throw new Error('Voice quota check unavailable')
  return { allowed: count < max, remaining: Math.max(0, max - count) }
}

export async function authorizeVoiceSession(input: {
  host: string
  sessionId?: string
  conversationId?: string
}): Promise<AuthorizedVoice> {
  const host = getHost(input.host)
  if (!host) throw new Error('Invalid host')
  const supabase = createServerSupabase()
  const { data: identity, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error('Unable to validate authentication')
  const userId = identity.user?.id ?? null
  const sessionId = typeof input.sessionId === 'string' &&
    /^[a-f0-9-]{36}$/i.test(input.sessionId) ? input.sessionId : null
  if (!userId && !sessionId) throw new Error('Session identity required')
  const admin = createAdminClient()
  let tier: Tier = userId ? 'explorer' : 'anonymous'
  if (userId) {
    const { data, error } = await admin.from('memberships')
      .select('tier,status').eq('user_id', userId).maybeSingle()
    if (error) throw new Error('Membership lookup unavailable')
    if (data?.status === 'active' && ['regular', 'vip'].includes(data.tier)) tier = data.tier as Tier
  }
  const quota = await checkVoiceQuota(userId, sessionId, tier)
  if (!quota.allowed) throw new Error('Voice usage allowance reached')

  // Never accept an arbitrary conversation ID without verifying ownership.
  let conversationId: string | null = null
  if (input.conversationId && /^[a-f0-9-]{36}$/i.test(input.conversationId)) {
    let q = admin.from('host_conversations').select('id')
      .eq('id', input.conversationId).eq('host_agent', host.id)
    q = userId ? q.eq('user_id', userId) : q.eq('session_id', sessionId!)
    const { data, error } = await q.maybeSingle()
    if (error) throw new Error('Conversation authorization unavailable')
    conversationId = data?.id ?? null
  }
  if (!conversationId) {
    const { data, error } = await admin.from('host_conversations')
      .insert({ user_id: userId, session_id: sessionId, host_agent: host.id, surface: 'web-chat', room_id: null })
      .select('id').single()
    if (error || !data) throw new Error('Unable to create voice conversation')
    conversationId = data.id
  }
  return { host: host.id, userId, sessionId, tier, conversationId }
}
