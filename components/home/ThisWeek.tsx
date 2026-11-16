import Link from 'next/link'
import { Calendar, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatEventDate, formatPrice, type EventRow } from '@/lib/events'

/**
 * "This Week at Café Sativa" — the schedule teaser on the home page.
 *
 * Shows the next 4 upcoming events across all categories, as a tight
 * list rather than the card grid used on /events. The list format
 * keeps the home page from getting visually repetitive after the
 * 6-card "Explore The Venue" grid.
 *
 * If there are zero upcoming events (e.g. a lull between seasons),
 * we fall back to a quiet "next season announcing soon" message
 * rather than showing an empty section.
 */

function categoryLabel(category: EventRow['category']): string {
  switch (category) {
    case 'stage':
      return 'The Stage'
    case 'kitchen':
      return 'The Kitchen'
    case 'cigar_lounge':
      return 'Cigar Lounge'
    case 'bar':
      return 'The Bar'
    case 'gallery':
      return 'The Gallery'
    case 'community':
      return 'Community'
    default:
      return 'Café Sativa'
  }
}

function accessLabel(access: EventRow['access'], price: number): string {
  if (access === 'ticketed') return 'You have a ticket'
  if (access === 'free') return 'Free to join'
  if (access === 'tier_included') return 'Included in your plan'
  return formatPrice(price)
}

export function ThisWeek({ events }: { events: EventRow[] }) {
  // Take the next 4 upcoming, regardless of category. If there's
  // a featured event, push it to the top — otherwise sort by date.
  const sorted = [...events].sort((a, b) => {
    if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1
    return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  })
  const upcoming = sorted.slice(0, 4)

  return (
    <section className="py-24 md:py-32 bg-card/30 border-y border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
          <div className="max-w-2xl">
            <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
              This Week
            </p>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
              What&rsquo;s happening now.
            </h2>
          </div>
          <Button variant="outline" asChild>
            <Link href="/events">
              View full schedule
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        </div>

        {upcoming.length === 0 ? (
          <div className="border border-border rounded-xl p-12 text-center">
            <Calendar className="w-8 h-8 text-primary mx-auto mb-4" />
            <p className="font-heading text-xl text-foreground mb-2">
              Next season announcing soon
            </p>
            <p className="text-sm text-muted-foreground font-body max-w-md mx-auto">
              We&rsquo;re between seasons. Join the mailing list below and we&rsquo;ll tell
              you the moment the next run of shows goes up.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {upcoming.map((evt) => {
              const date = formatEventDate(evt.starts_at)
              return (
                <li key={evt.id}>
                  <Link
                    href={`/events/${evt.slug}`}
                    className="group flex flex-col md:flex-row md:items-center gap-4 py-6 md:py-8 hover:bg-card/50 -mx-4 px-4 md:-mx-6 md:px-6 transition-colors"
                  >
                    {/* Date block */}
                    <div className="md:w-32 shrink-0">
                      <p className="font-heading text-3xl font-bold text-primary">
                        {date.dateShort.split(' ')[1]}
                      </p>
                      <p className="text-xs tracking-widest uppercase text-muted-foreground font-body">
                        {date.dateShort.split(' ')[0]} · {date.weekdayShort}
                      </p>
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant="outline" className="font-body">
                          {categoryLabel(evt.category)}
                        </Badge>
                        {evt.is_featured && (
                          <Badge className="font-body">Featured</Badge>
                        )}
                      </div>
                      <h3 className="font-heading text-xl md:text-2xl font-bold text-foreground group-hover:text-primary transition-colors">
                        {evt.title}
                      </h3>
                      {evt.subtitle && (
                        <p className="text-sm text-muted-foreground font-body mt-1">
                          {evt.subtitle}
                          {evt.presenter_name && ` · ${evt.presenter_name}`}
                        </p>
                      )}
                    </div>

                    {/* Right side — time + price */}
                    <div className="md:text-right shrink-0">
                      <p className="text-sm font-body text-foreground">
                        {date.time}
                      </p>
                      <p className="text-xs text-muted-foreground font-body mt-1">
                        {accessLabel(evt.access, evt.ticket_price_cents)}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
