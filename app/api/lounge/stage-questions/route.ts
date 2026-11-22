import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalConciergeHost } from '@/lib/content/concierge-canon'
import { getHost } from '@/lib/concierge/personas'
import { decideStageAutoReply } from '@/lib/events/stage-auto-reply'
import { PRIVATE_STAGE_REHEARSAL_ROOM, privateStagePlaybackSlot, rehearsalInviteCoversCut, soloStageHostTest } from '@/lib/events/private-stage-rehearsal'
import { stageHostIsPerforming, STAGE_HOST_ON_STAGE } from '@/lib/events/stage-host-availability'
import { safeStageConversationText } from '@/lib/events/stage-conversation-policy'
import { answerSoloStageQuestion } from '@/lib/events/stage-conversation'
import type { ConciergeMessage } from '@/lib/concierge/response-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const inbox = 'stage_host_questions'
const itemFields = 'id,host,question,answer,answer_source,created_at'
const json = (data: object, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const unavailable = () => json({ error: 'Stage questions are temporarily unavailable.' }, 503)

// Resolve all access with the attendee's own session before invoking a privileged client.
async function roomAccess(roomId: unknown) {
  if (roomId !== PRIVATE_STAGE_REHEARSAL_ROOM) return { error: json({ error: 'Stage room unavailable.' }, 404) }
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user || user.is_anonymous) return { error: json({ error: 'Sign in to use Stage questions.' }, 401) }
  const { data: room, error: roomError } = await db.from('lounge_rooms').select('id').eq('id', roomId).maybeSingle()
  if (roomError || !room) return { error: json({ error: 'Stage room unavailable.' }, 404) }

  const { data: invite } = await db.from('stage_rehearsal_invites').select('can_draft,expires_at')
    .eq('user_id', user.id).gt('expires_at', new Date().toISOString()).maybeSingle()
  const slot = privateStagePlaybackSlot(process.env)
  const now = Date.now()
  if (!invite || !slot || now < slot.start || now >= slot.end || !rehearsalInviteCoversCut(invite.expires_at, slot.end, slot.inviteUntil)) {
    return { error: json({ error: 'Stage questions are closed for this rehearsal.' }, 404) }
  }
  const solo = soloStageHostTest(slot, user.id, process.env)
  if (!solo && (process.env.VERCEL_ENV === 'production' || process.env.STAGE_HOST_INBOX_ENABLED !== 'true')) {
    return { error: json({ error: 'Stage questions are closed.' }, 404) }
  }
  return { attendeeId: user.id, roomId, moderator: !solo && invite.can_draft === true, startsAt: slot.startsAt, solo }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const access = await roomAccess(params.get('roomId'))
    if (access.error) return access.error
    const admin = createAdminClient()
    const [mine, pending] = await Promise.all([
      admin.from(inbox).select(itemFields).eq('room_id', access.roomId).eq('attendee_id', access.attendeeId)
        .order('created_at', { ascending: false }).limit(30),
      access.moderator ? admin.from(inbox).select(itemFields).eq('room_id', access.roomId)
        .is('answer', null).order('created_at').limit(40) : Promise.resolve({ data: [], error: null }),
    ])
    if (mine.error || pending.error) return unavailable()
    return json({ mine: mine.data, pending: pending.data, moderator: access.moderator })
  } catch { return unavailable() }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid origin.' }, 403)
  try {
    const body = await request.json().catch(() => null)
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (!uuid.test(typeof body?.id === 'string' ? body.id : '') || !question || question.length > 600 ||
        (body.host !== 'laviche' && body.host !== 'ahnika')) return json({ error: 'Enter a question up to 600 characters.' }, 400)
    const access = await roomAccess(body.roomId)
    if (access.error) return access.error
    const host = getHost(body.host)
    if (!host) return unavailable()
    if (stageHostIsPerforming(host.id)) return json({ error: STAGE_HOST_ON_STAGE }, 409)
    const admin = createAdminClient()
    const laviche = host.id === 'laviche'
    // The preview moderation exercise keeps its exact-fact policy. The bounded
    // solo path runs the persona only after the private insert wins dedup/rate checks.
    const decision = decideStageAutoReply({ question, host: host.id as 'laviche' | 'ahnika',
      facts: { startsAt: access.startsAt, format: 'scheduled-premiere', enableSoundControl: false, vipReplayPublished: false },
      enabled: !access.solo && process.env.STAGE_AUTO_TEXT_REPLIES_ENABLED === 'true' &&
        (!laviche || process.env.STAGE_LAVICHE_MODERATOR_ENABLED === 'true'), paused: false })
    const canonical = decision.action === 'eligible'
      ? await canonicalConciergeHost(host.id, AbortSignal.timeout(2500)).catch(() => null) : null
    const answer = !laviche && decision.action === 'eligible' && canonical ? decision.text : null
    const { data, error } = await admin.from(inbox).upsert({
      id: body.id, room_id: access.roomId, attendee_id: access.attendeeId, host: host.id, question,
      answer, answer_source: answer ? 'verified_host' : null,
    }, { onConflict: 'id', ignoreDuplicates: true }).select(itemFields).maybeSingle()
    if (error?.code === 'P0001' && error.message === 'stage_host_question_rate_limit') {
      return json({ error: 'Please wait before sending another question.' }, 429)
    }
    if (error) return unavailable()
    if (data) {
      if (access.solo && safeStageConversationText(question)) {
        const prior = await admin.from(inbox).select('question,answer').eq('room_id', access.roomId)
          .eq('attendee_id', access.attendeeId).eq('host', host.id).eq('answer_source', 'verified_host')
          .gte('created_at', access.startsAt).lt('created_at', data.created_at)
          .order('created_at', { ascending: false }).limit(4)
        if (prior.error) return json({ item: data }, 201)
        const history: ConciergeMessage[] = (prior.data || []).reverse().flatMap(row =>
          typeof row.answer === 'string' && !row.answer.startsWith('Automated test reply:') &&
          safeStageConversationText(row.question) && safeStageConversationText(row.answer)
            ? [{ role: 'user', content: row.question }, { role: 'assistant', content: row.answer }] : [])
        const reply = await answerSoloStageQuestion({ host: body.host, persona: host.system_prompt, question, history }).catch(() => null)
        if (reply && !stageHostIsPerforming(host.id)) {
          const current = await roomAccess(access.roomId)
          if (current.solo && current.attendeeId === access.attendeeId && current.startsAt === access.startsAt) {
            const saved = await admin.from(inbox).update({ answer: reply, answer_source: 'verified_host' })
              .eq('id', data.id).eq('room_id', access.roomId).eq('attendee_id', access.attendeeId)
              .eq('host', host.id).is('answer', null).select(itemFields).maybeSingle()
            if (!saved.error && saved.data) return json({ item: saved.data }, 201)
          }
        }
      }
      if (laviche && !access.solo && decision.action === 'eligible' && canonical) {
        const resolution = await admin.rpc('stage_resolve_laviche_question', {
          p_question_id: data.id, p_room_id: access.roomId, p_attendee_id: access.attendeeId,
          p_show_starts_at: access.startsAt,
        }).then(value => value, () => null)
        if (typeof resolution?.data === 'string' && !resolution.error) {
          return json({ item: { ...data, answer: resolution.data, answer_source: 'verified_host' } }, 201)
        }
      }
      return json({ item: data }, 201)
    }
    const existing = await admin.from(inbox).select(itemFields).eq('id', body.id)
      .eq('room_id', access.roomId).eq('attendee_id', access.attendeeId).maybeSingle()
    if (existing.error) return unavailable()
    if (existing.data?.host !== host.id || existing.data?.question !== question) return json({ error: 'Question could not be confirmed.' }, 409)
    return json({ item: existing.data })
  } catch { return unavailable() }
}

export async function PATCH(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid origin.' }, 403)
  try {
    const body = await request.json().catch(() => null)
    const answer = typeof body?.answer === 'string' ? body.answer.trim() : ''
    if (!uuid.test(typeof body?.id === 'string' ? body.id : '') || !answer || answer.length > 600) {
      return json({ error: 'Enter a reply up to 600 characters.' }, 400)
    }
    const access = await roomAccess(body.roomId)
    if (access.error) return access.error
    if (!access.moderator) return json({ error: 'Moderator access required.' }, 403)
    const { data, error } = await createAdminClient().from(inbox)
      .update({ answer, answer_source: 'moderator', resolved_by: access.attendeeId })
      .eq('room_id', access.roomId).eq('id', body.id).is('answer', null).select('id').maybeSingle()
    if (error) return unavailable()
    return data ? json({ resolved: true }) : json({ error: 'Question is no longer pending.' }, 409)
  } catch { return unavailable() }
}
