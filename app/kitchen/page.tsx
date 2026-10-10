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
      category="kitchen"
      title="The Kitchen"
      tagline="Cook along, live."
      description="Fusion cuisines, featured-chef programming and Café Sativa After Dark in the virtual Kitchen. Confirmed classes will include their actual hosts, ingredients and participation details."
      heroImage="/rooms/kitchen.webp"
      events={events}
    />
  )
}
