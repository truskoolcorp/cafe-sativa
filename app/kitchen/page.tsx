import type { Metadata } from 'next'
import { CategoryPage } from '@/components/events/CategoryPage'
import { getUpcomingEvents } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'The Kitchen',
  description:
    'Hands-on cooking classes, masterclasses, and culinary workshops with visiting chefs. Learn in real time with a real audience.',
}

export default async function KitchenPage() {
  const events = await getUpcomingEvents({ category: 'kitchen' })

  return (
    <CategoryPage
      title="The Kitchen"
      tagline="Cook along, live."
      description="Real-time cooking classes with visiting chefs. Prep ahead from our ingredient lists, then share a meal with the rest of the room when the class ends."
      heroImage="https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1920&q=80"
      events={events}
    />
  )
}
