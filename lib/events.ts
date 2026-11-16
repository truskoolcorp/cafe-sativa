import { createClient } from '@/lib/supabase/server'
import { HIT_EM_PREMIERE, publicHitEmPremiere } from '@/lib/events/hit-em-premiere'

/**
 * Shape of a row coming out of `my_events_v`.
 *
 * `access` is computed per-viewer by the view — it reflects whether
 * *this* authenticated user has a ticket, qualifies via membership
 * tier, or still needs to pay. Don't cache this cross-user or you'll
 * leak ticket state.
 */
export type EventRow = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  series: string | null
  category:
    | 'stage'
    | 'kitchen'
    | 'cigar_lounge'
    | 'bar'
    | 'gallery'
    | 'community'
    | null
  room_id: string
  presenter_name: string | null
  presenter_role: string | null
  starts_at: string
  ends_at: string | null
  status: string
  ticket_price_cents: number
  capacity: number | null
  free_for_tiers: string[]
  hero_image_url: string | null
  is_featured: boolean
  access: 'ticketed' | 'free' | 'tier_included' | 'purchase_required'
}

/**
 * Fetch upcoming events, optionally filtered to a category.
 *
 * Runs server-side so the RLS check uses the actual visitor's auth
 * cookie — the returned `access` field will reflect their real
 * membership/ticket status.
 */
export async function getUpcomingEvents(options?: {
  category?: EventRow['category']
  limit?: number
}): Promise<EventRow[]> {
  const supabase = createClient()
  let q = supabase
    .from('my_events_v')
    .select('*')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
  // Keep this approved public premiere discoverable after its start, until it
  // is explicitly ended/canceled. Do not infer a live status or an end time.
  let premiereQuery = supabase.from('my_events_v').select('*')
    .eq('id', HIT_EM_PREMIERE.eventId).eq('slug', HIT_EM_PREMIERE.slug)
    .in('status', ['scheduled', 'live'])

  if (options?.category) {
    q = q.eq('category', options.category)
    premiereQuery = premiereQuery.eq('category', options.category)
  }
  if (options?.limit) {
    // At most one unique premiere slug can be removed by the safety filter.
    q = q.limit(options.limit + 1)
  }

  const [upcoming, premiere] = await Promise.all([q, premiereQuery])
  if (upcoming.error) console.error('Upcoming event inventory is unavailable')
  if (premiere.error) console.error('Public premiere discovery is unavailable')
  const rows = [
    ...(upcoming.error ? [] : upcoming.data ?? []),
    ...(premiere.error ? [] : premiere.data ?? []),
  ] as EventRow[]
  const unique = new Map<string, EventRow>()
  for (const row of rows) {
    if (row.slug === HIT_EM_PREMIERE.slug) {
      const verified = publicHitEmPremiere(row)
      if (!verified || verified.state !== 'ready' || verified.status === 'ended') continue
    }
    unique.set(row.id, row)
  }
  const visible = Array.from(unique.values()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  return options?.limit ? visible.slice(0, options.limit) : visible
}

/**
 * Featured event, if any. Used by the Home page hero to pick the
 * "LIVE NOW" or "UP NEXT" promo. Falls back to the next upcoming
 * event if nothing is flagged featured.
 */
export async function getFeaturedEvent(): Promise<EventRow | null> {
  const supabase = createClient()
  const [featured, premiere] = await Promise.all([
    supabase.from('my_events_v').select('*').eq('is_featured', true)
      .gte('starts_at', new Date().toISOString()).order('starts_at', { ascending: true }).limit(2),
    supabase.from('my_events_v').select('*').eq('id', HIT_EM_PREMIERE.eventId)
      .eq('slug', HIT_EM_PREMIERE.slug).eq('is_featured', true).in('status', ['scheduled', 'live']).limit(1),
  ])
  // Keep filtering inside the bounded database query so a later explicitly
  // featured event is not hidden by the database's overall result cap.
  const candidates = [
    ...(featured.error ? [] : featured.data ?? []),
    ...(premiere.error ? [] : premiere.data ?? []),
  ] as EventRow[]
  const eligible = candidates.filter(event => {
    if (event.slug !== HIT_EM_PREMIERE.slug) return true
    const verified = publicHitEmPremiere(event)
    return verified?.state === 'ready' && verified.status !== 'ended'
  }).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  if (eligible[0]) return eligible[0]
  return (await getUpcomingEvents({ limit: 1 }))[0] ?? null
}

/**
 * Human-friendly date formatter. Returns its pieces separately so
 * callers can arrange them in different layouts (card vs. hero).
 */
export function formatEventDate(iso: string) {
  const d = new Date(iso)
  // Café Sativa programming runs on Central Time. Pin every formatter to
  // America/Chicago so dates render in venue-local time regardless of the
  // server's timezone (Vercel runs in UTC).
  const TZ = 'America/Chicago'
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: TZ }),
    weekdayShort: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ }),
    date: d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: TZ,
    }),
    dateShort: d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: TZ,
    }),
    time: d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: TZ,
    }),
  }
}

export function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}
