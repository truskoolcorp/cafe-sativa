import Image from 'next/image'
import Link from 'next/link'
import { Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EventCard } from '@/components/events/EventCard'
import type { EventRow } from '@/lib/events'

/**
 * Category landing page template used by /stage, /kitchen, and
 * /cigar-lounge.
 *
 * All three pages share a layout (full-bleed hero with mood image
 * and category description, then a 3-col grid of events). The
 * differences between them are data: hero image, copy, which
 * category to query, and whether to apply the VIP gate overlay.
 *
 * Keeping this as one template instead of three page files means
 * when we adjust the layout (e.g. add a filter strip or a
 * presenter highlight row) we only change it once.
 */

type CategoryPageProps = {
  /** Eyebrow label — "The Stage", "The Kitchen", etc. */
  title: string
  /** Bold tagline — one short sentence. */
  tagline: string
  /** Paragraph describing the room and its vibe. */
  description: string
  /** Hero image URL (full-bleed top band). */
  heroImage: string
  /** Upcoming events already filtered by this category. */
  events: EventRow[]
  /**
   * When true, events that require VIP membership get the locked-
   * card overlay. Used on /cigar-lounge where much of the
   * programming is members-only but we still want to tease it.
   */
  vipGateEnabled?: boolean
  /** Called-out extra section above the grid, optional. */
  intro?: React.ReactNode
}

export function CategoryPage({
  title,
  tagline,
  description,
  heroImage,
  events,
  vipGateEnabled = false,
  intro,
}: CategoryPageProps) {
  return (
    <>
      {/* Hero band */}
      <section className="relative h-[60vh] min-h-[440px] w-full overflow-hidden">
        <Image
          src={heroImage}
          alt=""
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
        <div className="relative z-10 h-full flex items-end pb-16 md:pb-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
            <div className="max-w-2xl">
              <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
                {title}
              </p>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
                {tagline}
              </h1>
              <p className="text-base md:text-lg text-muted-foreground font-body mt-4 leading-relaxed">
                {description}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Optional intro block (e.g. "Join VIP for full access") */}
      {intro && (
        <section className="border-t border-border bg-card/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {intro}
          </div>
        </section>
      )}

      {/* Event grid */}
      <section className="py-16 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {events.length === 0 ? (
            <div className="border border-border rounded-xl p-12 text-center max-w-2xl mx-auto">
              <Calendar className="w-8 h-8 text-primary mx-auto mb-4" />
              <p className="font-heading text-xl text-foreground mb-2">
                New programming coming soon
              </p>
              <p className="text-sm text-muted-foreground font-body max-w-md mx-auto">
                We&rsquo;re between runs. Join the mailing list on the home page
                and we&rsquo;ll tell you the moment the next show goes up.
              </p>
              <div className="mt-6">
                <Button variant="outline" asChild>
                  <Link href="/events">See full schedule</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
                <h2 className="font-heading text-3xl font-bold text-foreground">
                  Upcoming
                </h2>
                <p className="text-sm text-muted-foreground font-body">
                  {events.length} {events.length === 1 ? 'show' : 'shows'} scheduled
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {events.map((event) => {
                  const isVipOnly =
                    vipGateEnabled &&
                    event.access === 'purchase_required' &&
                    event.free_for_tiers?.length === 1 &&
                    event.free_for_tiers[0] === 'vip'
                  return (
                    <EventCard
                      key={event.id}
                      event={event}
                      vipGated={isVipOnly}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}
