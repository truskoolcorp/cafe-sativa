import { createClient } from '@/lib/supabase/server'
import { AHNIKA_PREMIERE_SLUG, isCanonicalAhnikaPremiere } from '@/lib/events/ahnika-premiere-window'
import { serveAhnikaPremiereMedia } from '@/lib/events/ahnika-premiere-media'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export function GET(request: Request) {
  return serveAhnikaPremiereMedia(request, {
    relayUrl: process.env.STAGE_RELEASE_MEDIA_RELAY_URL,
    key: process.env.STAGE_RELEASE_MEDIA_RELAY_KEY,
    fetch,
    canonical: async () => {
      const { data } = await createClient().from('my_events_v')
        .select('starts_at, presenter_name, ticket_price_cents, status')
        .eq('slug', AHNIKA_PREMIERE_SLUG).maybeSingle()
      return Boolean(data && isCanonicalAhnikaPremiere(data))
    },
  })
}
