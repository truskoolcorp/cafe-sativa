import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  try {
    const { data: { user }, error } = await createClient().auth.getUser()
    if (error || !user) return reply({ error: 'Sign in required.' }, 401)
    if (!params.slug || params.slug.length > 200) return reply({ error: 'Invalid event.' }, 400)
    const db = createAdminClient()
    const result = await db.from('events').select('id,status,ticket_price_cents,free_for_tiers,zoom_join_url,zoom_meeting_id').eq('slug', params.slug).maybeSingle()
    if (result.error) return reply({ error: 'Event access unavailable.' }, 503)
    const ev = result.data
    if (!ev || !['scheduled','live'].includes(ev.status)) return reply({ error: 'Event unavailable.' }, 404)
    const [ticket, membership] = await Promise.all([
      db.from('tickets').select('id').eq('event_id', ev.id).eq('user_id', user.id).in('state', ['valid','used']).limit(1),
      db.from('memberships').select('tier,status,current_period_end').eq('user_id', user.id).maybeSingle(),
    ])
    if (ticket.error || membership.error) return reply({ error: 'Access verification unavailable.' }, 503)
    const member = membership.data
    const active = !!member && member.status === 'active' && (!member.current_period_end || Date.parse(member.current_period_end) > Date.now())
    const included = active && Array.isArray(ev.free_for_tiers) && ev.free_for_tiers.includes(member.tier)
    if (!ticket.data?.length && ev.ticket_price_cents !== 0 && !included) return reply({ error: 'Ticket or membership required.' }, 403)
    return reply({ zoom_join_url: ev.zoom_join_url, zoom_meeting_id: ev.zoom_meeting_id })
  } catch { return reply({ error: 'Event join unavailable.' }, 503) }
}
