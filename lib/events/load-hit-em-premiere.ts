import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { HIT_EM_PREMIERE, publicHitEmPremiere } from '@/lib/events/hit-em-premiere'

// Only non-sensitive public listing fields are read. No tickets, memberships,
// account identity, Zoom credentials, recording URLs, or signed assets.
export async function loadHitEmPremiere() {
  const result = await createAdminClient().from('events')
    .select('id,slug,title,description,status,starts_at,ticket_price_cents')
    .eq('id', HIT_EM_PREMIERE.eventId).eq('slug', HIT_EM_PREMIERE.slug)
    .in('status', ['scheduled', 'live', 'ended', 'canceled']).maybeSingle()
  if (result.error) throw new Error('The event listing is temporarily unavailable.')
  return publicHitEmPremiere(result.data)
}
