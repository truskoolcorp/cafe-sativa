import { canonicalConciergeHost } from '@/lib/content/concierge-canon'
import { getSiteContent } from '@/lib/content/site'
import { getUpcomingEvents, type EventRow } from '@/lib/events'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHost } from '@/lib/concierge/personas'
import { checkRateLimit, type Tier } from '@/lib/concierge/rate-limit'
import { getMemoryContext } from '@/lib/concierge/memory'
import { chronologicalMessages } from '@/lib/concierge/history'
import { validateConciergeRequest } from '@/lib/concierge/request'
import { conciergeAdmissionDenial, conciergeRequesterValid, conciergeRequesterMatches, hasDurableIdentity } from '@/lib/concierge/capability'
import { conciergeOriginAllowed } from '@/lib/concierge/request-origin'
import { loungeMembershipTier } from '@/lib/lounge-membership'
import { conversationMatchesRequester } from '@/lib/concierge/conversation-access'
import { conciergeEventFacts, verifiedPremiereAnswer } from '@/lib/concierge/programming'
import { jsonWithCors, preflight } from '@/lib/cors'
import { generateConciergeResponse } from '@/lib/concierge/response-engine'

/**
 * POST /api/concierge
 *
 * Body: {
 *   host: 'laviche' | 'ginger' | 'ahnika',
 *   message: string,
 *   session_id?: string,     // opaque guest identifier; website generates UUIDs
 *   conversation_id?: string, // for multi-turn continuity
 *   surface: 'web-chat' | 'mall-3d' | 'email',
 *   room_id?: string          // which room they're in (mall-3d only)
 * }
 *
 * Response (success):
 *   { message: string, conversation_id: string, remaining: number }
 *
 * Response (rate-limited):
 *   { error: string, rate_limited: true, resets_in_seconds: number }
 *
 * Flow:
 *   1. Validate input.
 *   2. Load host persona or 404.
 *   3. Resolve the requester — Supabase auth gives us user_id if
 *      signed in. For anonymous, the client must send session_id.
 *   4. Load their tier (from memberships; default 'explorer' if none).
 *   5. Check rate limit. If denied, return 429 with a polite message
 *      (not a browser-default 429 page).
 *   6. Find or create a conversation row.
 *   7. Retrieve memory-window context (90d for Regular, 365d for VIP).
 *   8. Build the Messages API request: system prompt + context + user
 *      message.
 *   9. Call Anthropic (claude-haiku-4-5 for speed).
 *  10. Persist user message + assistant reply to host_messages.
 *  11. Return reply.
 *
 * This route is the single entry point for BOTH surfaces. The 3D
 * mall chat and the /ask page both POST here. When the real Railway
 * orchestrator at agents.truskool.net exists, we swap the Anthropic
 * call for a fetch to the orchestrator and keep everything else.
 */

export const runtime = 'nodejs'
export const maxDuration = 60 // seconds

export async function POST(req: Request) {
  try {
    return await handlePost(req)
  } catch {
    console.error('[concierge] Request dependencies are temporarily unavailable')
    return jsonWithCors({ error: 'Concierge is temporarily unavailable. Please try again shortly.' }, { status: 503, request: req })
  }
}

async function handlePost(req: Request) {
  // CORS response headers alone do not stop a simple cross-site POST from
  // running server work. Reject an unapproved browser origin before any I/O.
  if (!conciergeOriginAllowed(req)) {
    return jsonWithCors({ error: 'This chat origin is not allowed.', code: 'origin_not_allowed' }, { status: 403, request: req })
  }
  const denial = conciergeAdmissionDenial(req)
  if (denial) return jsonWithCors({ error: denial.error, code: denial.code }, { status: denial.status, request: req, noStore: true })
  if (!conciergeRequesterValid(req)) {
    return jsonWithCors({ error: 'The expected chat identity is missing or invalid.', code: 'requester_changed' }, { status: 409, request: req, noStore: true })
  }
  const value = await req.json().catch(() => null)
  if (hasDurableIdentity(value)) {
    return jsonWithCors({ error: 'Durable chat is not available on this deployment. Keep the original request.', code: 'mode_changed' }, { status: 409, request: req, noStore: true })
  }
  const parsed = validateConciergeRequest(value)
  if (!parsed.valid) return jsonWithCors({ error: parsed.error }, { status: 400, request: req })
  const body = parsed.body
  const host = getHost(body.host)!
  const surface = body.surface

  const anthropicKey = process.env.ANTHROPIC_API_KEY

  // Identify the requester
  const supabase = createServerSupabase()
  const { data: userData, error: authError } = await supabase.auth.getUser()
  if (authError && authError.name !== 'AuthSessionMissingError') {
    return jsonWithCors({ error: 'Chat identity is temporarily unavailable.', code: 'auth_unavailable' }, { status: 503, request: req, noStore: true })
  }
  const userId = userData?.user?.id ?? null

  const sessionId = body.session_id
  if (!conciergeRequesterMatches(req, userId, sessionId)) {
    return jsonWithCors({ error: 'The signed-in identity changed. Return to the original account or session.', code: 'requester_changed' }, { status: 409, request: req, noStore: true })
  }
  if (!userId && !sessionId) {
    return jsonWithCors(
      { error: 'Send a session_id for anonymous chats.', code: 'missing_session' },
      { status: 400, request: req }
    )
  }

  // Resolve tier
  const admin = createAdminClient()
  let tier: Tier = userId ? 'explorer' : 'anonymous'
  if (userId) {
    const { data: memRow, error: membershipError } = await admin
      .from('memberships')
      .select('tier, status, current_period_end')
      .eq('user_id', userId)
      .maybeSingle()
    if (membershipError) return jsonWithCors({ error: 'Membership access is temporarily unavailable.' }, { status: 503, request: req })
    tier = loungeMembershipTier(memRow)
  }

  // Rate limit
  const rate = await checkRateLimit({ userId, sessionId, tier })
  if (!rate.allowed) {
    return jsonWithCors(
      {
        error: rate.message,
        rate_limited: !rate.unavailable,
        ...(rate.unavailable ? { code: 'usage_unavailable' } : {}),
        resets_in_seconds: rate.resetsInSeconds,
      },
      { status: rate.unavailable ? 503 : 429, request: req }
    )
  }

  let canonicalHost
  try {canonicalHost=await canonicalConciergeHost(host.id)}catch{}
  if(!canonicalHost)return jsonWithCors({error:'The approved host context is temporarily unavailable. Please retry; no substitute identity was used.'},{status:503,request:req})
  let liveProgramming='Current programming could not be verified. Do not invent dates or availability.'
  let verifiedEvents: EventRow[] = []
  try {
    const [features,events]=await Promise.all([getSiteContent().catch(() => []),getUpcomingEvents({limit:6})])
    verifiedEvents = events
    liveProgramming=JSON.stringify({features:features.slice(0,6).map(item=>({title:item.title,category:item.site_category,releaseAt:item.release_at,released:item.released,overview:item.copy_final.slice(0,1200)})),events:events.map(conciergeEventFacts)})
  }catch{}

  // Find or create conversation. We key by (user_id or session_id) +
  // host_agent. Same user talking to Laviche on web and again on mall
  // continues the same conversation.
  let conversationId = body.conversation_id ?? null

  if (conversationId) {
    if (typeof conversationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
      return jsonWithCors({error:'Invalid conversation.'},{status:400,request:req})
    }
    const {data:conversation,error:conversationError}=await admin.from('host_conversations')
      .select('user_id,session_id,host_agent,ended_at').eq('id',conversationId).maybeSingle()
    if (conversationError) return jsonWithCors({error:'Conversation is temporarily unavailable.'},{status:503,request:req})
    if (!conversationMatchesRequester(conversation,{userId,sessionId,host:host.id})) {
      return jsonWithCors({error:'This conversation is unavailable for this host and session.',code:'conversation_unavailable'},{status:403,request:req})
    }
  }

  if (!conversationId) {
    // Look for an active conversation from the last 4 hours
    const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000).toISOString()
    let activeQuery = admin
      .from('host_conversations')
      .select('id')
      .eq('host_agent', host.id)
      .gte('started_at', fourHoursAgo)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)

    if (userId) {
      activeQuery = activeQuery.eq('user_id', userId)
    } else {
      activeQuery = activeQuery.eq('session_id', sessionId!).is('user_id',null)
    }

    const { data: existingConv, error: activeError } = await activeQuery.maybeSingle()
    if (activeError) return jsonWithCors({ error: 'Conversation is temporarily unavailable.' }, { status: 503, request: req })
    conversationId = existingConv?.id ?? null
  }

  if (!conversationId) {
    const { data: newConv, error: convError } = await admin
      .from('host_conversations')
      .insert({
        user_id: userId,
        session_id: sessionId,
        host_agent: host.id,
        surface,
        room_id: body.room_id ?? null,
      })
      .select('id')
      .single()

    if (convError || !newConv) {
      console.error('[concierge] Failed to create conversation', convError)
      return jsonWithCors({ error: 'Could not start conversation.' }, { status: 500, request: req })
    }
    conversationId = newConv.id
  }

  // Retrieve prior memory (90d/365d for Regular/VIP). Anonymous and
  // Explorer get just the current conversation's messages, which we
  // load next.
  const priorMessages = await getMemoryContext({
    userId,
    hostAgent: host.id,
    tier,
    excludeConversationId: conversationId!,
  })

  // Load the current conversation's message history. We want these
  // AFTER any prior-memory context so the model sees them as the most
  // recent exchange.
  const { data: currentConvMessages, error: historyError } = await admin
    .from('host_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(30)

  if (historyError) return jsonWithCors({ error: 'Conversation history is temporarily unavailable.' }, { status: 503, request: req })
  const currentMessages = chronologicalMessages(currentConvMessages ?? [])

  // Build the Messages API request
  type MessageParam = { role: 'user' | 'assistant'; content: string }
  const messages: MessageParam[] = []

  // Prior-memory messages first (if any)
  for (const m of priorMessages) {
    messages.push({ role: m.role, content: m.content })
  }

  // Then current conversation turns (excluding the message about to
  // be sent, which we haven't persisted yet)
  for (const m of currentMessages) {
    messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
  }

  // Finally the incoming message
  messages.push({ role: 'user', content: body.message })

  // Exact launch FAQ answers are grounded in the fresh public event record.
  // They still pass ownership/rate checks and persist like any other turn.
  let replyText = verifiedPremiereAnswer(body.message, verifiedEvents)
  if (replyText === null) {
    if (!anthropicKey) {
      console.error('[concierge] Missing ANTHROPIC_API_KEY')
      return jsonWithCors({ error: 'Concierge is offline.', code: 'not_configured' }, { status: 503, request: req })
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey,timeout:25000,maxRetries:0 })
    // Call the model only for general conversation.
    try {
      replyText = await generateConciergeResponse({
        hostSystemPrompt: host.system_prompt,
        canonicalContext: canonicalHost.context,
        liveProgramming,
        messages,
      }, request => anthropic.messages.create(request))
    } catch (err: any) {
      // Log every field we can get our hands on. When this fires in prod,
      // the Vercel dashboard truncates the message preview but the full
      // structured log is retrievable via the Logs tab. Include request
      // shape too so we can reproduce without needing to inspect the
      // route source.
      console.error('[concierge] Anthropic call failed', {
        status: err?.status,
        message: err?.message,
        error_type: err?.error?.type,
        error_message: err?.error?.message,
        request_id: err?.headers?.['request-id'],
        model_used: 'claude-haiku-4-5-20251001',
        host: host.id,
        message_count_in_request: messages.length,
        // Capture the whole thing too — the log preview truncates to the
        // first property of an object, so list the suspects first.
        raw: err?.toString?.() || String(err),
      })

      // Diagnostic escape hatch: clients can include `X-Concierge-Debug:
      // 1` to receive the full error details inline. Only effective when
      // CONCIERGE_DEBUG=1 is also set on the server — belt + suspenders
      // so a curious visitor can't probe production.
      const debugRequested = req.headers.get('x-concierge-debug') === '1'
      const debugEnabled = process.env.CONCIERGE_DEBUG === '1'
      const debugPayload =
        debugRequested && debugEnabled
          ? {
              debug: {
                status: err?.status ?? null,
                message: err?.message ?? null,
                error_type: err?.error?.type ?? null,
                error_message: err?.error?.message ?? null,
                request_id: err?.headers?.['request-id'] ?? null,
                model_used: 'claude-haiku-4-5-20251001',
                message_count: messages.length,
                raw: err?.toString?.() || String(err),
              },
            }
          : {}

      return jsonWithCors(
        {
          error: 'Concierge is having trouble right now. Try again in a bit.',
          // Expose the upstream error type ONLY — never the message, since
          // upstream error messages can leak prompt content or keys.
          upstream_error_type: err?.error?.type || null,
          ...debugPayload,
        },
        { status: 502, request: req }
      )
    }

  }

  // Persist both messages. We do this AFTER the model call succeeds
  // so a failed call doesn't leave a dangling user message with no
  // reply.
  const { error: persistError } = await admin.from('host_messages').insert([
    {
      conversation_id: conversationId,
      role: 'user',
      content: body.message,
    },
    {
      conversation_id: conversationId,
      role: 'assistant',
      content: replyText,
    },
  ])

  if (persistError) {
    // Non-fatal — we still give the user their answer. But log loudly
    // so we notice if it starts happening.
    console.error('[concierge] Failed to persist messages', persistError)
  }

  return jsonWithCors(
    {
      message: replyText,
      conversation_id: conversationId,
      host: host.id,
      remaining: rate.remaining,
      memory_saved: !persistError,
      ...(persistError ? { warning: 'Your reply was delivered, but this turn could not be saved for future conversation memory.' } : {}),
    },
    { status: 200, request: req }
  )
}

/**
 * OPTIONS preflight for CORS. Browsers send this before any
 * cross-origin POST that has a custom Content-Type or header.
 * Answers 204 with the allow-* headers if the origin is whitelisted
 * in lib/cors.ts.
 */
export async function OPTIONS(req: Request) {
  return preflight(req)
}
