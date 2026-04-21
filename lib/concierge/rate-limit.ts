import { createAdminClient } from '@/lib/supabase/admin'

export type Tier = 'anonymous' | 'explorer' | 'regular' | 'vip'

/**
 * Rate limits per tier. These match docs/ARCHITECTURE.md §4 and
 * shared/venue-config.json rate_limits. Keep them in sync.
 *
 * The value is the maximum number of user-sent messages (not including
 * assistant replies) within the window. Anonymous users are capped per
 * hour to discourage scrape abuse; authenticated users are capped per
 * day because the quality-of-life cost of hitting a per-hour limit
 * while reading is worse than the abuse cost of a per-day limit.
 */
const RATE_LIMITS: Record<Tier, { max: number; windowSeconds: number }> = {
  anonymous: { max: 10, windowSeconds: 3600 },
  explorer: { max: 50, windowSeconds: 86400 },
  regular: { max: 200, windowSeconds: 86400 },
  vip: { max: 1000, windowSeconds: 86400 },
}

export type RateCheckResult =
  | { allowed: true; remaining: number; resetsInSeconds: number }
  | { allowed: false; message: string; resetsInSeconds: number }

/**
 * Check whether this user (or session, for anon users) is under the
 * rate limit. Counts `host_messages` with role='user' in the window.
 *
 * This is a simple count-in-window limiter — not a true sliding window.
 * Good enough for a venue concierge where the goal is to stop abuse,
 * not to implement token-bucket semantics.
 */
export async function checkRateLimit(params: {
  userId: string | null
  sessionId: string | null
  tier: Tier
}): Promise<RateCheckResult> {
  const { userId, sessionId, tier } = params
  const limit = RATE_LIMITS[tier]
  if (!limit) {
    return {
      allowed: false,
      message: 'Unknown tier.',
      resetsInSeconds: 0,
    }
  }

  const admin = createAdminClient()
  const since = new Date(Date.now() - limit.windowSeconds * 1000).toISOString()

  // We count user-role messages across all conversations belonging
  // to this user OR session. Anonymous users have no user_id so we
  // fall back to session_id. Authenticated users have both (if they
  // have an active session from before signing in), so we use user_id.
  let query = admin
    .from('host_messages')
    .select('id, host_conversations!inner(user_id, session_id)', {
      count: 'exact',
      head: true,
    })
    .eq('role', 'user')
    .gte('created_at', since)

  if (userId) {
    query = query.eq('host_conversations.user_id', userId)
  } else if (sessionId) {
    query = query.eq('host_conversations.session_id', sessionId)
  } else {
    return {
      allowed: false,
      message: 'No user or session id available.',
      resetsInSeconds: 0,
    }
  }

  const { count, error } = await query

  if (error) {
    // If the rate-limit query fails, fail open (allow the request).
    // We'd rather serve the user than block them because of our own
    // infrastructure problem. Log it so we can fix it.
    console.error('[concierge-rate-limit] count query failed', error)
    return { allowed: true, remaining: limit.max, resetsInSeconds: limit.windowSeconds }
  }

  const used = count ?? 0

  if (used >= limit.max) {
    return {
      allowed: false,
      message: tierLimitCopy(tier),
      resetsInSeconds: limit.windowSeconds,
    }
  }

  return {
    allowed: true,
    remaining: limit.max - used,
    resetsInSeconds: limit.windowSeconds,
  }
}

function tierLimitCopy(tier: Tier): string {
  switch (tier) {
    case 'anonymous':
      return "You've hit the hourly message cap for guest chats. Sign in and the limit lifts."
    case 'explorer':
      return "You've used your daily concierge allowance. It resets in 24 hours, or you can upgrade for a larger allowance."
    case 'regular':
      return "You've used your daily concierge allowance. It resets in 24 hours."
    case 'vip':
      return 'Rate limit reached. This is unusual for VIP — try again in a bit.'
  }
}
