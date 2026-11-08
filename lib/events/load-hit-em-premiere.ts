import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { HIT_EM_PREMIERE, publicHitEmPremiere } from '@/lib/events/hit-em-premiere'

// Use the existing public listing view, never the admin-only events table or
// a service-role key. This view exposes scheduled/live events only; drafts,
// ended and canceled events are unavailable here, including to signed-in hosts.
// Only non-sensitive public listing fields are read. No tickets, memberships,
// account identity, Zoom credentials, recording URLs, or signed assets.
export async function loadHitEmPremiere() {
  const result = await createClient().from('my_events_v')
    .select('id,slug,title,description,status,starts_at,ticket_price_cents')
    .eq('id', HIT_EM_PREMIERE.eventId).eq('slug', HIT_EM_PREMIERE.slug)
    .in('status', ['scheduled', 'live']).maybeSingle()
  if (result.error) throw new Error('The event listing is temporarily unavailable.')
  if (!result.data || !['scheduled', 'live'].includes(result.data.status)) return null
  return publicHitEmPremiere(result.data)
}
