import { NextResponse } from 'next/server'
import { workerAuthenticated } from '@/lib/concierge/livekit-worker-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHost } from '@/lib/concierge/personas'
import { getMemoryContext } from '@/lib/concierge/memory'
import type { Tier } from '@/lib/concierge/rate-limit'

export const runtime = 'nodejs'
export async function POST(req: Request) {
  if (!workerAuthenticated(req) || process.env.CAFE_SATIVA_LIVEKIT_ENABLED !== '1')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const room = body?.room
  if (typeof room !== 'string' || !/^cafe-sativa-(laviche|ginger|ahnika)-[a-f0-9]{32}$/.test(room))
    return NextResponse.json({ error: 'Invalid room' }, { status: 400 })
  const admin = createAdminClient()
  const { data: session, error } = await admin.from('cafe_voice_sessions')
    .select('host_agent,conversation_id,user_id,tier,expires_at,revoked_at')
    .eq('room_name', room).maybeSingle()
  if (error || !session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now())
    return NextResponse.json({ error: 'Expired or unrecognized session' }, { status: 403 })
  const host = getHost(session.host_agent)
  if (!host || !room.startsWith(`cafe-sativa-${host.id}-`))
    return NextResponse.json({ error: 'Host mismatch' }, { status: 403 })
  const { data: recent, error: recentError } = await admin.from('host_messages')
    .select('role,content,created_at')
    .eq('conversation_id', session.conversation_id).in('role', ['user','assistant'])
    .order('created_at', { ascending: false }).limit(30)
  if (recentError) return NextResponse.json({ error: 'Conversation unavailable' }, { status: 503 })
  const earlier = await getMemoryContext({
    userId: session.user_id, hostAgent: host.id, tier: session.tier as Tier,
  })
  return NextResponse.json({
    host: host.id, conversation_id: session.conversation_id,
    instructions: host.system_prompt,
    prior_context: earlier,
    current_context: (recent ?? []).reverse(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
