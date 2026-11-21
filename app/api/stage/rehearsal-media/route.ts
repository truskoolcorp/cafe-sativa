import { createClient } from '@/lib/supabase/server'
import { privateStagePlaybackSlot, rehearsalInviteCoversCut } from '@/lib/events/private-stage-rehearsal'
import { AHNIKA_PREMIERE_SLUG, isCanonicalAhnikaPremiere } from '@/lib/events/ahnika-premiere-window'
import { servePrivateAhnikaCut } from '@/lib/events/ahnika-premiere-media'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export function GET(request: Request) {
  const slot = privateStagePlaybackSlot(process.env)
  if (!slot) return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  return servePrivateAhnikaCut(request, slot, {
    relayUrl: process.env.STAGE_RELEASE_MEDIA_RELAY_URL,
    key: process.env.STAGE_RELEASE_MEDIA_RELAY_KEY,
    fetch,
    canonical: async () => {
      const db = createClient()
      const { data: { user } } = await db.auth.getUser()
      if (!user || user.is_anonymous) return false
      const { data: invitation } = await db.from('stage_rehearsal_invites').select('expires_at')
        .eq('user_id', user.id).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (!invitation || !rehearsalInviteCoversCut(invitation.expires_at, slot.end)) return false
      const { data: approved } = await db.from('my_events_v')
        .select('starts_at, presenter_name, ticket_price_cents, status').eq('slug', AHNIKA_PREMIERE_SLUG).maybeSingle()
      return Boolean(approved && isCanonicalAhnikaPremiere(approved))
    },
  })
}
