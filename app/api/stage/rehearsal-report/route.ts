import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { privateDressMedia } from '@/lib/events/private-dress-media'
import { PRIVATE_STAGE_REHEARSAL_ROOM, privateStagePlaybackSlot, rehearsalInviteCoversCut, privateDressReportSlot } from '@/lib/events/private-stage-rehearsal'

export const dynamic = 'force-dynamic'
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const closed = () => reply({ error: 'Private rehearsal reporting is closed.' }, 404)
const unavailable = () => reply({ error: 'Could not reach the report queue. Please try again.' }, 503)

async function access() {
  if (process.env.STAGE_PRIVATE_DRESS_REPORTS_ENABLED !== 'true' || !privateDressMedia(process.env.STAGE_PRIVATE_DRESS_MEDIA)) return null
  const slot = privateStagePlaybackSlot(process.env)
  const now = Date.now()
  if (!slot?.dress || !privateDressReportSlot(slot.startsAt) || now < slot.dress.doors || now >= slot.dress.closes) return null
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user || user.is_anonymous) return null
  const [{ data: invite }, { data: room }] = await Promise.all([
    db.from('stage_rehearsal_invites').select('expires_at,can_draft').eq('user_id', user.id).maybeSingle(),
    db.from('lounge_rooms').select('id').eq('id', PRIVATE_STAGE_REHEARSAL_ROOM).maybeSingle(),
  ])
  if (!room || !invite || !rehearsalInviteCoversCut(invite.expires_at, slot.dress.closes, slot.inviteUntil)) return null
  return { db, userId: user.id, staff: invite.can_draft === true, doors: new Date(slot.dress.doors).toISOString() }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid origin.' }, 403)
  const body = await request.json().catch(() => null)
  if (!body || typeof body.messageId !== 'string' || !uuid.test(body.messageId)) return reply({ error: 'Invalid report target.' }, 400)
  try {
    const viewer = await access()
    if (!viewer) return closed()
    const { data: target } = await viewer.db.from('lounge_messages').select('id')
      .eq('id', body.messageId).eq('room_id', PRIVATE_STAGE_REHEARSAL_ROOM).neq('user_id', viewer.userId)
      .gte('created_at', viewer.doors).is('deleted_at', null).maybeSingle()
    if (!target) return reply({ error: 'This message is not available to report.' }, 404)
    const { data, error } = await createAdminClient().rpc('stage_dress_report_message', {
      p_message_id: body.messageId, p_reporter_id: viewer.userId,
    })
    if (error) return unavailable()
    if (data === 'rate_limited') return reply({ error: 'Please wait a minute before sending another report.' }, 429)
    if (['needs_review', 'hidden_by_laviche', 'hidden_by_staff', 'dismissed'].includes(data)) return reply({ status: data })
    return closed()
  } catch { return unavailable() }
}

export async function GET(request: Request) {
  try {
    const viewer = await access()
    if (!viewer) return closed()
    const db = createAdminClient()
    if (new URL(request.url).searchParams.get('mode') === 'hidden') {
      const { data, error } = await db.from('stage_dress_message_reports').select('message_id')
        .in('status', ['hidden_by_laviche', 'hidden_by_staff']).limit(250)
      return error ? unavailable() : reply({ hidden: [...new Set((data ?? []).map(item => item.message_id))] })
    }
    if (!viewer.staff) return closed()
    const { data, error } = await db.from('stage_dress_message_reports').select('message_id')
      .eq('status', 'needs_review').order('created_at', { ascending: true }).limit(30)
    if (error) return unavailable()
    const ids = [...new Set((data ?? []).map(item => item.message_id))]
    if (!ids.length) return reply({ items: [] })
    const { data: messages, error: messageError } = await db.from('lounge_messages').select('id,content')
      .eq('room_id', PRIVATE_STAGE_REHEARSAL_ROOM).gte('created_at', viewer.doors).is('deleted_at', null).in('id', ids)
    return messageError ? unavailable() : reply({ items: messages ?? [] })
  } catch { return unavailable() }
}

export async function PATCH(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid origin.' }, 403)
  const body = await request.json().catch(() => null)
  if (!body || typeof body.messageId !== 'string' || !uuid.test(body.messageId) ||
      !['remove', 'dismiss'].includes(body.action)) return reply({ error: 'Invalid review action.' }, 400)
  try {
    const viewer = await access()
    if (!viewer?.staff) return closed()
    const { data, error } = await createAdminClient().rpc('stage_dress_review_report', {
      p_message_id: body.messageId, p_staff_id: viewer.userId, p_action: body.action,
    })
    if (error) return unavailable()
    return data === true ? reply({ resolved: true }) : reply({ error: 'This report is no longer pending.' }, 409)
  } catch { return unavailable() }
}
