import { Hero } from '@/components/home/Hero'
import { ExploreVenue } from '@/components/home/ExploreVenue'
import { ThisWeek } from '@/components/home/ThisWeek'
import { MembershipTeaser } from '@/components/home/MembershipTeaser'
import { NeverMiss } from '@/components/home/NeverMiss'
import { getFeaturedEvent, getUpcomingEvents } from '@/lib/events'

// Server component. We run the Supabase queries here so the first
// paint already has the event list rendered — no client-side loading
// spinner on the homepage. Marked `force-dynamic` because `access`
// is user-dependent and we don't want Next caching one visitor's
// ticket state as the default for everyone.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [featured, upcoming] = await Promise.all([
    getFeaturedEvent(),
    getUpcomingEvents({ limit: 6 }),
  ])

  return (
    <>
      <Hero featured={featured} />
      <ExploreVenue />
      <ThisWeek events={upcoming} />
      <MembershipTeaser />
      <NeverMiss />
    </>
  )
}
