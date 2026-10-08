import { NextResponse } from 'next/server'
import { workerAuthenticated } from '@/lib/concierge/livekit-worker-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export async function POST(req: Request) {
  if (!workerAuthenticated(req) || process.env.CAFE_SATIVA_LIVEKIT_ENABLED !== '1')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const room = body?.room
  const turnId = body?.turn_id
  const userText = typeof body?.user_text === 'string' ? body.user_text.trim() : ''
  const assistantText = typeof body?.assistant_text === 'string' ? body.assistant_text.trim() : ''
  if (typeof room !== 'string' || !/^cafe-sativa-(laviche|ginger|ahnika)-[a-f0-9]{32}$/.test(room) ||
      typeof turnId !== 'string' || !/^[a-f0-9-]{36}$/i.test(turnId) ||
      !userText || !assistantText || userText.length > 2000 || assistantText.length > 4000)
    return NextResponse.json({ error: 'Invalid turn' }, { status: 400 })
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('persist_cafe_voice_turn', {
    p_room: room, p_turn_id: turnId, p_user_text: userText, p_assistant_text: assistantText,
  })
  if (error) {
    console.error('[voice-turn] Atomic persistence refused:', error.code || 'unknown')
    return NextResponse.json({ error: 'Voice turn could not be recorded' }, { status: 503 })
  }
  return NextResponse.json({ ok: true, status: data }, { headers: { 'Cache-Control': 'no-store' } })
}
