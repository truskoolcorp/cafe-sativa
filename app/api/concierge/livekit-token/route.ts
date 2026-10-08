import { randomBytes } from 'node:crypto'
import { AccessToken } from 'livekit-server-sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeVoiceSession } from '@/lib/concierge/livekit-authorization'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Deliberately closed until the worker validates canonical personas,
// message persistence, per-turn quota and cancellation.
export async function POST(req: Request) {
  if (process.env.CAFE_SATIVA_LIVEKIT_ENABLED !== '1') {
    return NextResponse.json({ error: 'Real-time voice not enabled.' }, { status: 503 })
  }
  const origin = req.headers.get('origin')
  const allowed = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com').origin
  if (!origin || origin !== allowed) return NextResponse.json({ error: 'Origin forbidden' }, { status: 403 })
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: 'Voice service unavailable' }, { status: 503 })
  }
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    const authorized = await authorizeVoiceSession({
      host: body.host,
      sessionId: body.session_id,
      conversationId: body.conversation_id,
    })
    const room = `cafe-sativa-${authorized.host}-${randomBytes(16).toString('hex')}`
    const expiry = new Date(Date.now() + 10 * 60_000)
    const admin = createAdminClient()
    const { error } = await admin.from('cafe_voice_sessions').insert({
      room_name: room, host_agent: authorized.host, conversation_id: authorized.conversationId,
      user_id: authorized.userId, session_id: authorized.sessionId,
      tier: authorized.tier, expires_at: expiry.toISOString(),
    })
    if (error) throw new Error('Unable to register voice session')
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: `cafe-guest-${randomBytes(12).toString('hex')}`, ttl: '10m',
    })
    token.addGrant({ room, roomJoin: true, canPublish: true, canPublishData: false, canSubscribe: true })
    return NextResponse.json({
      url: process.env.LIVEKIT_URL,
      token: await token.toJwt(),
      room, conversation_id: authorized.conversationId,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[voice-token] Authorization denied:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Voice session denied or unavailable' }, { status: 403 })
  }
}
