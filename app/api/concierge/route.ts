import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHost, type HostId } from '@/lib/concierge/personas'
import { checkRateLimit, type Tier } from '@/lib/concierge/rate-limit'
import { getMemoryContext } from '@/lib/concierge/memory'

/**
 * POST /api/concierge
 *
 * Body: {
 *   host: 'laviche' | 'ginger' | 'ahnika',
 *   message: string,
 *   session_id?: string,     // for anonymous users (client-generated uuid)
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
export const maxDuration = 30 // seconds

type RequestBody = {
  host?: string
  message?: string
  session_id?: string
  conversation_id?: string
  surface?: string
  room_id?: string
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null

  if (!body || typeof body.message !== 'string' || body.message.trim().length === 0) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }
  if (body.message.length > 2000) {
    return NextResponse.json(
      { error: 'Message is too long. Keep it under 2000 characters.' },
      { status: 400 }
    )
  }

  const host = getHost(body.host ?? '')
  if (!host) {
    return NextResponse.json(
      { error: `Unknown host. Expected one of: laviche, ginger, ahnika.` },
      { status: 400 }
    )
  }

  const surface = body.surface
  if (surface !== 'web-chat' && surface !== 'mall-3d' && surface !== 'email') {
    return NextResponse.json(
      { error: 'surface must be one of: web-chat, mall-3d, email.' },
      { status: 400 }
    )
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    console.error('[concierge] Missing ANTHROPIC_API_KEY')
    return NextResponse.json(
      { error: 'Concierge is offline.', code: 'not_configured' },
      { status: 503 }
    )
  }

  // Identify the requester
  const supabase = createServerSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id ?? null

  const sessionId = body.session_id?.trim() || null
  if (!userId && !sessionId) {
    return NextResponse.json(
      { error: 'Send a session_id for anonymous chats.', code: 'missing_session' },
      { status: 400 }
    )
  }

  // Resolve tier
  const admin = createAdminClient()
  let tier: Tier = userId ? 'explorer' : 'anonymous'
  if (userId) {
    const { data: memRow } = await admin
      .from('memberships')
      .select('tier, status')
      .eq('user_id', userId)
      .maybeSingle()
    if (memRow && memRow.status === 'active') {
      tier = memRow.tier as Tier
    }
  }

  // Rate limit
  const rate = await checkRateLimit({ userId, sessionId, tier })
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: rate.message,
        rate_limited: true,
        resets_in_seconds: rate.resetsInSeconds,
      },
      { status: 429 }
    )
  }

  // Find or create conversation. We key by (user_id or session_id) +
  // host_agent. Same user talking to Laviche on web and again on mall
  // continues the same conversation.
  let conversationId = body.conversation_id ?? null

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
      activeQuery = activeQuery.eq('session_id', sessionId!)
    }

    const { data: existingConv } = await activeQuery.maybeSingle()
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
      return NextResponse.json({ error: 'Could not start conversation.' }, { status: 500 })
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
  })

  // Load the current conversation's message history. We want these
  // AFTER any prior-memory context so the model sees them as the most
  // recent exchange.
  const { data: currentConvMessages } = await admin
    .from('host_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .limit(30)

  const currentMessages = currentConvMessages ?? []

  // Build the Messages API request
  const anthropic = new Anthropic({ apiKey: anthropicKey })

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

  // Call the model
  let replyText: string
  try {
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: host.system_prompt,
      messages,
    })

    // The response is a list of content blocks. For our use case
    // (no tool use) we expect exactly one text block.
    replyText = completion.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!replyText) {
      replyText = "Sorry, I didn't catch that — try me again?"
    }
  } catch (err: any) {
    console.error('[concierge] Anthropic call failed', {
      status: err?.status,
      message: err?.message,
    })
    return NextResponse.json(
      { error: 'Concierge is having trouble right now. Try again in a bit.' },
      { status: 502 }
    )
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

  return NextResponse.json({
    message: replyText,
    conversation_id: conversationId,
    host: host.id,
    remaining: rate.allowed ? rate.remaining : 0,
  })
}
