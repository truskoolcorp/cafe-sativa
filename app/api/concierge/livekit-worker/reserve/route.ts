import { NextResponse } from 'next/server'
import { workerAuthenticated } from '@/lib/concierge/livekit-worker-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// Experimental reservation endpoint. Current LiveKit agent does NOT call this
// before LLM/TTS; therefore the feature must remain disabled until it does.
export async function POST(req: Request) {
  if (process.env.CAFE_SATIVA_LIVEKIT_ENABLED !== '1' || !workerAuthenticated(req))
    return NextResponse.json({ error: 'Unavailable' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.room !== 'string' ||
      !/^cafe-sativa-(laviche|ginger|ahnika)-[a-f0-9]{32}$/.test(body.room) ||
      typeof body?.turn_id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.turn_id))
    return NextResponse.json({ error: 'Invalid reservation' }, { status: 400 })
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('reserve_cafe_voice_turn', {
    p_room: body.room, p_turn_id: body.turn_id,
  })
  if (error) {
    console.error('[voice-reserve] Reservation rejected:', error.code || 'unknown')
    return NextResponse.json({ error: 'Voice capacity unavailable' }, { status: 503 })
  }
  return NextResponse.json({ status: data }, { headers: { 'Cache-Control': 'no-store' } })
}
