import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import type { EventRow } from '@/lib/events'
import { formatEventDate } from '@/lib/events'

/**
 * Full-bleed hero at the top of the home page.
 *
 * The visual job of this section is to communicate, within one
 * screenful, three things that aren't obvious from the word
 * "Café":
 *
 *   1. This is a cultural *venue*, not a coffee brand. Hence the
 *      hero image (smoky, lit interior), the serif headline, and
 *      the SIP • SMOKE • VIBE line. Those words together only make
 *      sense as a place.
 *
 *   2. Something is happening here, not sitting idle. Hence the
 *      live/upcoming event pill — pulled from the real schedule.
 *      If there's a featured event within 2h, we say LIVE NOW;
 *      otherwise we say NEXT SHOW and show the date.
 *
 *   3. Tenerife is coming. Hence the subtle italic footer line.
 *      It disarms the "virtual-only" skepticism without
 *      overpromising — we say 2026, not "now."
 */

export function Hero({ featured }: { featured: EventRow | null }) {
  // Is the featured event happening right now (within a 2-hour window)?
  const now = Date.now()
  const startMs = featured ? new Date(featured.starts_at).getTime() : 0
  const isLive = featured && Math.abs(now - startMs) < 2 * 60 * 60 * 1000
  const eventCta = featured ? `/events/${featured.slug}` : '/events'
  const eventDate = featured ? formatEventDate(featured.starts_at) : null

  return (
    <section className="relative h-screen min-h-[700px] w-full overflow-hidden">
      {/* Background image — layered under gradient overlays. The photo
          is a warm, lit, slightly smoky interior. `priority` because
          this is LCP; `fill` so it covers the section regardless of
          viewport; object-position slightly low so the faces/lights
          sit in the upper third. */}
      <Image
        src="https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1920&q=80"
        alt=""
        fill
        priority
        className="object-cover object-[center_40%]"
        sizes="100vw"
      />

      {/* Bottom-heavy gradient so the text at the bottom is legible
          against whatever the photo happens to show. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/20 to-background" />

      {/* Warm amber ambient wash — gives the whole thing a
          lantern-lit feel even on cooler photos. */}
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-transparent" />

      {/* Content column */}
      <div className="relative z-10 h-full flex items-end pb-24 md:pb-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-3xl space-y-6">
            {/* Live / next-show pill */}
            {featured && (
              <Link
                href={eventCta}
                className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/60 backdrop-blur-sm px-4 py-2 text-xs font-body tracking-widest uppercase text-primary hover:bg-primary/10 transition-colors"
              >
                <span
                  className={
                    isLive
                      ? 'inline-block w-2 h-2 rounded-full bg-destructive animate-pulse'
                      : 'inline-block w-2 h-2 rounded-full bg-primary'
                  }
                />
                {isLive ? 'Live Now' : `Next Show · ${eventDate?.dateShort}`}
              </Link>
            )}

            {/* Headlines */}
            <div className="space-y-3">
              <p className="text-sm tracking-widest uppercase text-muted-foreground font-body">
                Welcome to Café Sativa
              </p>
              <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground leading-[1.05]">
                Where Culture Gathers
                <br />
                <span className="text-primary italic">Before the Doors Open.</span>
              </h1>
              <p className="font-heading text-xl sm:text-2xl text-foreground/80 tracking-[0.3em] uppercase pt-4">
                Sip <span className="text-primary mx-2">·</span> Smoke{' '}
                <span className="text-primary mx-2">·</span> Vibe
              </p>
            </div>

            {/* Subhead + CTAs */}
            <div className="pt-6 space-y-6">
              <p className="text-base md:text-lg text-muted-foreground font-body max-w-xl leading-relaxed">
                A virtual venue for live music, cooking classes, cigar tastings, art,
                and the conversations that happen between them.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href={eventCta}>
                    Enter The Lounge
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/membership">Explore Membership</Link>
                </Button>
              </div>
            </div>

            {/* Tenerife tagline — quiet, italic, below the fold but
                visible on tall viewports */}
            <div className="pt-8 border-t border-border/40 max-w-md">
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body">
                Physical Venue Opening
              </p>
              <p className="font-heading italic text-lg text-foreground/90 mt-1">
                Tenerife, Spain · 2026
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
