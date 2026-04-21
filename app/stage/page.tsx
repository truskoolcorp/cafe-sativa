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
      title="The Stage"
      tagline="Where the house lights dim."
      description="Interviews, acoustic sets, comedy, and spoken word — performed live with a real audience room. Most shows are free with membership."
      heroImage="https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1920&q=80"
      events={events}
    />
  )
}
