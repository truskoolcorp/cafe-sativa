import type { Metadata } from 'next'
import { CategoryPage } from '@/components/events/CategoryPage'
import { getUpcomingEvents } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'The Stage',
  description:
    'Live interviews, acoustic sets, comedy nights, and spoken word at Café Sativa. Upcoming shows and how to join.',
}

export default async function StagePage() {
  const events = await getUpcomingEvents({ category: 'stage' })

  return (
    <CategoryPage
      category="stage"
      title="The Stage"
      tagline="Where the house lights dim."
      description="Explore the virtual Stage: interviews, music, comedy and spoken word. Confirmed sessions and their access details appear in the schedule."
      heroImage="/rooms/stage.webp"
      events={events}
    />
  )
}
