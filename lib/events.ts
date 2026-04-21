import { createClient } from '@/lib/supabase/server'

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

  if (options?.category) {
    q = q.eq('category', options.category)
  }
  if (options?.limit) {
    q = q.limit(options.limit)
  }

  const { data, error } = await q
  if (error) {
    console.error('getUpcomingEvents failed:', error.message)
    return []
  }
  return (data ?? []) as EventRow[]
}

/**
 * Featured event, if any. Used by the Home page hero to pick the
 * "LIVE NOW" or "UP NEXT" promo. Falls back to the next upcoming
 * event if nothing is flagged featured.
 */
export async function getFeaturedEvent(): Promise<EventRow | null> {
  const supabase = createClient()

  // Prefer an explicitly featured future event.
  const { data: featured } = await supabase
    .from('my_events_v')
    .select('*')
    .eq('is_featured', true)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)

  if (featured && featured.length > 0) return featured[0] as EventRow

  // Otherwise just the next upcoming event of any kind.
  const { data: next } = await supabase
    .from('my_events_v')
    .select('*')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)

  return (next && next.length > 0 ? next[0] : null) as EventRow | null
}

/**
 * Human-friendly date formatter. Returns its pieces separately so
 * callers can arrange them in different layouts (card vs. hero).
 */
export function formatEventDate(iso: string) {
  const d = new Date(iso)
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    weekdayShort: d.toLocaleDateString('en-US', { weekday: 'short' }),
    date: d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    dateShort: d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    time: d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  }
}

export function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}
