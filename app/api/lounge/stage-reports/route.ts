import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AHNIKA_AUDIENCE_SCHEDULE, AHNIKA_PREMIERE_SLUG, ahnikaAudiencePhase } from '@/lib/events/ahnika-premiere-window'

export const dynamic = 'force-dynamic'
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const reply = (value: object, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
const closed = () => reply({ error: 'Stage reports are not open.' }, 404)
const unavailable = () => reply({ error: 'Could not reach Stage moderation. Try again shortly.' }, 503)

async function access(roomId: unknown) {
  if (process.env.STAGE_PREMIERE_REPORTS_ENABLED !== 'true' || typeof roomId !== 'string' || !uuid.test(roomId)) return null
  const db = createClient()
  const { data: { user }, error: authError } = await db.auth.getUser()
  if (authError || !user || user.is_anonymous) return null
  const [room, event, grant] = await Promise.all([
    db.from('lounge_rooms').select('id').eq('id', roomId).eq('slug', AHNIKA_PREMIERE_SLUG).maybeSingle(),
    db.from('my_events_v').select('starts_at,presenter_name,ticket_price_cents,status').eq('slug', AHNIKA_PREMIERE_SLUG).maybeSingle(),
    db.from('stage_premiere_reply_moderators').select('user_id').eq('room_id', roomId).eq('user_id', user.id).maybeSingle(),
  ])
  if (room.error || !room.data || event.error || !event.data) return null
  const phase = ahnikaAudiencePhase(event.data)
  if (phase !== 'mingling' && phase !== 'hosted') return null
  return { db, roomId, userId: user.id, staff: !grant.error && Boolean(grant.data) }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid origin.' }, 403)
  const body = await request.json().catch(() => null)
  if (typeof body?.messageId !== 'string' || !uuid.test(body.messageId)) return reply({ error: 'Invalid message.' }, 400)
  try {
    const viewer = await access(body.roomId)
    if (!viewer) return closed()
    const { data: target, error: targetError } = await viewer.db.from('lounge_messages').select('id')
      .eq('room_id', viewer.roomId).eq('id', body.messageId).neq('user_id', viewer.userId)
      .gte('created_at', new Date(AHNIKA_AUDIENCE_SCHEDULE.doors).toISOString()).is('deleted_at', null).maybeSingle()
    if (targetError || !target) return closed()
    const { data, error } = await createAdminClient().rpc('stage_premiere_report_message', {
      p_room: viewer.roomId, p_message: body.messageId, p_reporter: viewer.userId,
    })
    if (error) return unavailable()
    if (data === 'rate_limited') return reply({ error: 'Please wait a minute before reporting again.' }, 429)
    if (!['needs_review','hidden_by_laviche','hidden_by_staff','dismissed'].includes(data)) return closed()
    return reply({ status: data })
  } catch { return unavailable() }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const viewer = await access(params.get('roomId'))
    if (!viewer) return closed()
    const { data, error } = await createAdminClient().rpc('stage_premiere_report_state', { p_room: viewer.roomId, p_viewer: viewer.userId })
    if (error) return unavailable()
    if (!data) return closed()
    if (!Array.isArray(data.hidden)) return unavailable()
    return reply(viewer.staff && Array.isArray(data.pending) ? { hidden: data.hidden, pending: data.pending } : { hidden: data.hidden })
  } catch { return unavailable() }
}

export async function PATCH(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid origin.' }, 403)
  const body = await request.json().catch(() => null)
  if (typeof body?.messageId !== 'string' || !uuid.test(body.messageId) ||
      !['remove','dismiss'].includes(body.action)) return reply({ error: 'Invalid review action.' }, 400)
  try {
    const viewer = await access(body.roomId)
    if (!viewer?.staff) return closed()
    const { data, error } = await createAdminClient().rpc('stage_premiere_review_report', {
      p_room: viewer.roomId, p_message: body.messageId, p_staff: viewer.userId, p_action: body.action,
    })
    if (error) return unavailable()
    return data === true ? reply({ resolved: true }) : reply({ error: 'Report is no longer pending.' }, 409)
  } catch { return unavailable() }
}
