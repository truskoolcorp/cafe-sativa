import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { MessageCircle, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'The Lounge — Coming Soon',
  description:
    'The Café Sativa member lounge — a persistent chat community — launches with Episode 1. Members-only.',
}

/**
 * Holding page for /lounge. The real Lounge is a Discord-style
 * persistent chat with channels per category, live during events.
 * It needs Supabase Realtime, moderation tooling, and a full-page
 * chat UI — none of which ship for Ep 1.
 *
 * For now, the page tells visitors it's coming with Ep 1 and
 * routes them toward the Ask page (which is live now) as an
 * immediate alternative for connecting with our AI hosts.
 */
export default function LoungeHoldingPage() {
  return (
    <section className="relative h-[70vh] min-h-[500px] w-full overflow-hidden">
      <Image
        src="https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1920&q=80"
        alt=""
        fill
        priority
        className="object-cover"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/50 to-background" />

      <div className="relative z-10 h-full flex items-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/60 backdrop-blur-sm px-4 py-2">
              <MessageCircle className="w-4 h-4 text-primary" />
              <span className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                The Lounge
              </span>
            </div>

            <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground leading-[1.05]">
              Opens with <span className="text-primary italic">Episode 1.</span>
            </h1>

            <p className="text-base md:text-lg text-muted-foreground font-body max-w-xl leading-relaxed">
              A persistent chat community for members — channels for each room, live
              during events, running quietly in the background the rest of the
              week. Launching June 15 with Episode 1 of At The Table.
            </p>

            <div className="pt-2 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild>
                  <Link href="/membership">
                    Join a tier
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/ask">Talk to a host now</Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground font-body">
                The Lounge is included with every paid membership tier. Explorer
                members can still talk to our AI hosts via <Link href="/ask" className="underline hover:text-foreground">Ask</Link>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
