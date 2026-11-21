import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.room_id !== 'string' || !uuid.test(body.room_id) ||
      typeof body.message_id !== 'string' || !uuid.test(body.message_id)) {
    return NextResponse.json({ error: 'Invalid report target.' }, { status: 400 })
  }
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: 'Sign in to report a message.' }, { status: 401 })
  }
  const { error } = await db.from('lounge_message_reports').insert({
    room_id: body.room_id, message_id: body.message_id,
  })
  if (!error || error.code === '23505') return NextResponse.json({ ok: true })
  if (error.code === '42501' || error.code === '23503') {
    return NextResponse.json({ error: 'This message cannot be reported.' }, { status: 403 })
  }
  return NextResponse.json({ error: 'Reporting is temporarily unavailable.' }, { status: 503 })
}
