import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Palette, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'The Gallery — Coming Soon',
  description:
    'The Café Sativa Gallery launches after Episode 1. Rotating exhibits, artist conversations, and original work from our resident artists.',
}

/**
 * Holding page for /gallery. The real Gallery — with a products
 * table, Stripe Connect for artists, exhibitions, and artist Q&As
 * — is a post-launch build. This page exists so the nav link
 * doesn't 404 and so visitors can express interest.
 *
 * The "Artist applications opening" line is intentional — Keith
 * has a roster of Dallas and Tenerife artists lined up and this
 * page is the soft opening for that process.
 */
export default function GalleryHoldingPage() {
  return (
    <>
      <section className="relative h-[70vh] min-h-[500px] w-full overflow-hidden">
        <Image
          src="https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=1920&q=80"
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
                <Palette className="w-4 h-4 text-primary" />
                <span className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                  The Gallery
                </span>
              </div>

              <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground leading-[1.05]">
                Opening with <span className="text-primary italic">Episode 2.</span>
              </h1>

              <p className="text-base md:text-lg text-muted-foreground font-body max-w-xl leading-relaxed">
                Our first rotating exhibition opens alongside Episode 2 of At The Table.
                Original work from resident artists across Dallas and the Canary
                Islands — shoppable, with a cut going directly to each artist.
              </p>

              <div className="pt-2 space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button size="lg" asChild>
                    <Link href="/events">
                      See what&rsquo;s on now
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link href="/contact?topic=artist">Apply as an artist</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground font-body">
                  Artist applications reviewed monthly. We accept submissions in all
                  media — painting, photography, mixed media, sculpture.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
