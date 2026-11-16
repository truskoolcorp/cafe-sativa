import { notFound } from 'next/navigation'
import HitEmPremiere from '@/components/events/HitEmPremiere'
import { canPreviewHitEm, hitEmPreviewFixture } from '@/lib/events/hit-em-preview'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function generateMetadata() {
  return {
    title: canPreviewHitEm(process.env) ? 'Private Hit Em page preview' : 'Café Sativa',
    robots: { index: false, follow: false },
  }
}

export default function HitEmPrivatePreviewPage() {
  if (!canPreviewHitEm(process.env)) notFound()
  return <>
    <aside aria-label="Private preview notice" className="mx-auto mt-24 max-w-5xl rounded-lg border border-border bg-card p-4 text-foreground">
      <strong>Private preview. This page does not publish the event.</strong>
      <p className="mt-2 text-sm">This is a test rendering of the approved event details, not the live listing. The calendar file points to the planned public event address. Do not share this preview link.</p>
    </aside>
    <HitEmPremiere event={hitEmPreviewFixture()} calendarHref="/preview/hit-em-release-party/calendar" />
  </>
}
