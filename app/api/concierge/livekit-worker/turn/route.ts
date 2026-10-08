import { NextResponse } from 'next/server'
import { workerAuthenticated } from '@/lib/concierge/livekit-worker-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkVoiceQuota } from '@/lib/concierge/livekit-authorization'
import type { Tier } from '@/lib/concierge/rate-limit'

export const runtime = 'nodejs'
export async function POST(req: Request) {
  if (!workerAuthenticated(req) || process.env.CAFE_SATIVA_LIVEKIT_ENABLED !== '1')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const room = body?.room
  const userText = typeof body?.user_text === 'string' ? body.user_text.trim() : ''
  const assistantText = typeof body?.assistant_text === 'string' ? body.assistant_text.trim() : ''
  if (typeof room !== 'string' || !/^cafe-sativa-(laviche|ginger|ahnika)-[a-f0-9]{32}$/.test(room) ||
      !userText || !assistantText || userText.length > 2000 || assistantText.length > 4000)
    return NextResponse.json({ error: 'Invalid turn' }, { status: 400 })
  const admin = createAdminClient()
  const { data: session, error } = await admin.from('cafe_voice_sessions')
    .select('conversation_id,user_id,session_id,tier,expires_at,revoked_at')
    .eq('room_name', room).maybeSingle()
  if (error || !session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now())
    return NextResponse.json({ error: 'Unauthorized room' }, { status: 403 })
  try {
    const quota = await checkVoiceQuota(session.user_id, session.session_id, session.tier as Tier)
    if (!quota.allowed) return NextResponse.json({ error: 'Usage limit reached' }, { status: 429 })
  } catch {
    return NextResponse.json({ error: 'Usage check unavailable' }, { status: 503 })
  }
  // This is intentionally not considered an atomic enforcement boundary:
  // before production, replace with an RPC that reserves usage and inserts
  // a unique turn ID in one database transaction.
  const { error: writeError } = await admin.from('host_messages').insert([
    { conversation_id: session.conversation_id, role: 'user', content: userText },
    { conversation_id: session.conversation_id, role: 'assistant', content: assistantText },
  ])
  if (writeError) return NextResponse.json({ error: 'Turn persistence failed' }, { status: 503 })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
