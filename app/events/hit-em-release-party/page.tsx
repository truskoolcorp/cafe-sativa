import { notFound } from 'next/navigation'
import HitEmPremiere from '@/components/events/HitEmPremiere'
import { loadHitEmPremiere } from '@/lib/events/load-hit-em-premiere'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function generateMetadata() {
  const event = await loadHitEmPremiere()
  if (!event || event.state === 'canceled') return { title: 'Café Sativa events', robots: { index: false, follow: false } }
  return {
    title: 'Hit Em Release Party',
    description: 'Free public Hit Em premiere gathering, November 11 at midnight Dallas time. Watch the YouTube premiere and join its chat.',
    alternates: { canonical: 'https://www.cafe-sativa.com/events/hit-em-release-party' },
    openGraph: {
      title: 'Hit Em Release Party | Café Sativa',
      description: 'Free public Hit Em premiere gathering, November 11 at midnight Dallas time. Watch the YouTube premiere and join its chat.',
      type: 'website',
      url: 'https://www.cafe-sativa.com/events/hit-em-release-party',
    },
  }
}

export default async function HitEmReleasePartyPage() {
  const event = await loadHitEmPremiere()
  if (!event) notFound()
  return <HitEmPremiere event={event} />
}
