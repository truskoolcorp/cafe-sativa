import type { Metadata } from 'next'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CategoryPage } from '@/components/events/CategoryPage'
import { getUpcomingEvents } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cigar Lounge',
  description:
    'Guided cigar tastings, master blender Q&As, and pairing nights. Most programming is members-only — join the Regular or VIP tier to unlock.',
}

/**
 * The Cigar Lounge is our members-heavy room. Much of its
 * programming is either Regular-and-up (pairings, tastings) or
 * VIP-only (master blender Q&As). We intentionally leave these
 * events *visible* to anonymous browsers with a lock overlay — the
 * goal is to communicate the value of upgrading, not to hide it.
 *
 * The intro block at the top explains the gate so people don't
 * feel tricked when they hit the lock icons on cards.
 */
export default async function CigarLoungePage() {
  const events = await getUpcomingEvents({ category: 'cigar_lounge' })

  const intro = (
    <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full border border-primary/40 bg-background/60 flex items-center justify-center">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
            Most tastings are members-only
          </p>
          <p className="text-sm text-muted-foreground font-body">
            Master blender sessions require VIP.
          </p>
        </div>
      </div>
      <div className="flex-1" />
      <Button size="sm" asChild>
        <Link href="/membership">View membership tiers</Link>
      </Button>
    </div>
  )

  return (
    <CategoryPage
      title="Cigar Lounge"
      tagline="Smoke, spoken softly."
      description="Guided tastings, blind flights, and conversations with working master blenders. Most programming is members-only — free with Regular, everything unlocked with VIP."
      heroImage="https://images.unsplash.com/photo-1574068468668-a05a11f871da?w=1920&q=80"
      events={events}
      vipGateEnabled
      intro={intro}
    />
  )
}
