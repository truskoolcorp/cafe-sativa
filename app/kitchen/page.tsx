import type { Metadata } from 'next'
import { CategoryPage } from '@/components/events/CategoryPage'
import { getUpcomingEvents } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'The Kitchen',
  description:
    "Explore Café Sativa’s virtual Kitchen, hosted by Andromeda Zouganelis, with culinary conversations, recipes, and future guest-chef programming.",
}

export default async function KitchenPage() {
  const events = await getUpcomingEvents({ category: 'kitchen' })

  return (
    <CategoryPage
      category="kitchen"
      title="The Kitchen"
      tagline="Cook along, live."
      description="Meet Andromeda Zouganelis, the Café Sativa Kitchen host. Explore global flavors, culinary stories, and creative conversations. Guest chefs and confirmed classes will be announced with their actual hosts, ingredients, and participation details."
      heroImage="/rooms/kitchen.webp"
      events={events}
    />
  )
}
