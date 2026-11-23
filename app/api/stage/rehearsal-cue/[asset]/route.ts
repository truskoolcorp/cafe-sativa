import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AHNIKA_PREMIERE_SLUG, isCanonicalAhnikaPremiere } from '@/lib/events/ahnika-premiere-window'
import { isDressAssetName, privateDressMedia, servePrivateDressAsset } from '@/lib/events/private-dress-media'
import { privateStagePlaybackSlot } from '@/lib/events/private-stage-rehearsal'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, { params: { asset } }: { params: { asset: string } }) {
  const slot = privateStagePlaybackSlot(process.env)
  const media = privateDressMedia(process.env.STAGE_PRIVATE_DRESS_MEDIA)
  if (!slot?.dress || !media || !isDressAssetName(asset)) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  }
  return servePrivateDressAsset(request, slot, asset, media[asset], {
    invitation: async () => {
      const db = createClient()
      const { data: { user } } = await db.auth.getUser()
      if (!user || user.is_anonymous) return null
      const { data: invitation } = await db.from('stage_rehearsal_invites').select('expires_at')
        .eq('user_id', user.id).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (!invitation) return null
      const { data: event } = await db.from('my_events_v')
        .select('starts_at, presenter_name, ticket_price_cents, status').eq('slug', AHNIKA_PREMIERE_SLUG).maybeSingle()
      return event && isCanonicalAhnikaPremiere(event) ? invitation.expires_at : null
    },
    sign: async (bucket, object) => {
      const storage = createAdminClient().storage
      const { data: target } = await storage.getBucket(bucket)
      if (!target || target.public !== false) return null
      const { data } = await storage.from(bucket).createSignedUrl(object, 60)
      return data?.signedUrl ?? null
    },
    fetch,
  })
}
