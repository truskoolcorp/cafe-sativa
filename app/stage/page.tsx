import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CategoryPage } from '@/components/events/CategoryPage'
import { getUpcomingEvents } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'The Stage',
  description:
    'Live interviews, acoustic sets, comedy nights, and spoken word at Café Sativa. Upcoming shows and how to join.',
}

export default async function StagePage() {
  const [events, { data: premiere }] = await Promise.all([
    getUpcomingEvents({ category: 'stage' }),
    createClient().from('my_events_v').select('slug, starts_at, ticket_price_cents, presenter_name')
      .eq('slug', 'ahnika-already-gone').eq('category', 'stage').maybeSingle(),
  ])
  const showWatchLink = premiere && premiere.presenter_name === 'Ahnika Merlot' &&
    premiere.ticket_price_cents === 0 &&
    Date.parse(premiere.starts_at) === Date.parse('2026-12-01T06:00:00.000Z') &&
    Date.now() >= Date.parse(premiere.starts_at)

  return (
    <CategoryPage
      category="stage"
      title="The Stage"
      tagline="Where the house lights dim."
      description="Explore the virtual Stage: interviews, music, comedy and spoken word. Confirmed sessions and their access details appear in the schedule."
      heroImage="/rooms/stage.webp"
      events={events}
      intro={showWatchLink ? <Link className="text-primary underline" href="/events/ahnika-already-gone">Watch Ahnika Merlot’s Already Gone premiere</Link> : undefined}
    />
  )
}
