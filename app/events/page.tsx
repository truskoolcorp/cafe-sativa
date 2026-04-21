import type { Metadata } from 'next'
import Link from 'next/link'
import { Calendar } from 'lucide-react'
import { EventCard } from '@/components/events/EventCard'
import { Button } from '@/components/ui/button'
import { getUpcomingEvents, type EventRow } from '@/lib/events'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Events',
  description:
    'Every upcoming event at Café Sativa — stage, kitchen, cigar lounge, and bar. Members included free, everyone welcome.',
}

/**
 * /events — the full schedule.
 *
 * Unlike the category pages (/stage, /kitchen, /cigar-lounge)
 * which filter to one category, /events shows everything. Visitors
 * can narrow down with the filter chip row at the top, which
 * writes to the URL as ?category=<slug>. That URL state is
 * shareable and survives refresh.
 *
 * Reuses EventCard from components/events so every event surface
 * in the site (home This Week list, category pages, and this
 * index) presents the same card when the same event appears.
 * Visual consistency matters more here than minor layout tweaks.
 */

type SearchParams = { category?: string }

const FILTERS: Array<{
  label: string
  value: EventRow['category'] | 'all'
  href: string
}> = [
  { label: 'All', value: 'all', href: '/events' },
  { label: 'The Stage', value: 'stage', href: '/events?category=stage' },
  { label: 'The Kitchen', value: 'kitchen', href: '/events?category=kitchen' },
  {
    label: 'Cigar Lounge',
    value: 'cigar_lounge',
    href: '/events?category=cigar_lounge',
  },
  { label: 'The Bar', value: 'bar', href: '/events?category=bar' },
  { label: 'Gallery', value: 'gallery', href: '/events?category=gallery' },
  { label: 'Community', value: 'community', href: '/events?category=community' },
]

// Narrow the raw query-string category to a valid EventRow['category']
// or null. Anything else falls back to "show all".
function normalizeCategory(raw: string | undefined): EventRow['category'] | null {
  const valid: EventRow['category'][] = [
    'stage',
    'kitchen',
    'cigar_lounge',
    'bar',
    'gallery',
    'community',
  ]
  if (raw && valid.includes(raw as EventRow['category'])) {
    return raw as EventRow['category']
  }
  return null
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const filter = normalizeCategory(searchParams.category)
  const events = await getUpcomingEvents({
    category: filter ?? undefined,
  })

  const activeValue: EventRow['category'] | 'all' = filter ?? 'all'

  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Events
          </p>
          <h1 className="font-heading text-5xl md:text-6xl font-bold text-foreground leading-tight">
            What&rsquo;s on at Café Sativa.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground font-body mt-6 leading-relaxed">
            Live interviews, cooking classes, tastings, and performances — all
            streamed from the venue. Members get in free; everyone else grabs a
            ticket.
          </p>
        </div>

        {/* Category filter chips */}
        <div className="mt-12 flex flex-wrap gap-2 justify-center">
          {FILTERS.map((f) => {
            const isActive = activeValue === f.value
            return (
              <Link
                key={f.value}
                href={f.href}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-body transition-colors border',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80 bg-card/50'
                )}
              >
                {f.label}
              </Link>
            )
          })}
        </div>

        {/* Results */}
        <div className="mt-16">
          {events.length === 0 ? (
            <div className="border border-border rounded-xl p-12 text-center max-w-2xl mx-auto">
              <Calendar className="w-8 h-8 text-primary mx-auto mb-4" />
              <p className="font-heading text-xl text-foreground mb-2">
                {filter
                  ? 'Nothing in this category right now'
                  : 'Next season announcing soon'}
              </p>
              <p className="text-sm text-muted-foreground font-body max-w-md mx-auto">
                {filter ? (
                  <>
                    Try another category, or see the full schedule below.
                  </>
                ) : (
                  <>
                    We&rsquo;re between runs. Join the mailing list on the home
                    page and we&rsquo;ll tell you the moment the next show
                    goes up.
                  </>
                )}
              </p>
              {filter && (
                <div className="mt-6">
                  <Button variant="outline" asChild>
                    <Link href="/events">See all events</Link>
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
                <p className="text-sm text-muted-foreground font-body">
                  Showing {events.length}{' '}
                  {events.length === 1 ? 'event' : 'events'}
                  {filter && ` in ${FILTERS.find((f) => f.value === filter)?.label}`}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
