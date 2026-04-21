import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * "Become a Member" — three-tier pricing on the home page.
 *
 * This mirrors /membership but intentionally shows *less* — home
 * page visitors are mostly still deciding whether the venue is for
 * them. Three cards, three benefit highlights each. If they want
 * the full feature matrix they can click through.
 *
 * Pricing + tier names are the source of truth in Stripe and in
 * Supabase. If this ever diverges from those, the Stripe webhook
 * will stop recognizing tier names and create_checkout will fail —
 * keep them in lockstep.
 */

type Tier = {
  id: 'explorer' | 'regular' | 'vip'
  name: string
  price: string
  cadence: string
  description: string
  highlights: string[]
  ctaLabel: string
  ctaHref: string
  featured?: boolean
}

const TIERS: Tier[] = [
  {
    id: 'explorer',
    name: 'Explorer',
    price: '$0',
    cadence: 'forever',
    description: 'Browse the venue. Buy tickets à la carte.',
    highlights: [
      'Walk the 3D venue',
      'Purchase tickets to any event',
      'Chat with our AI hosts',
    ],
    ctaLabel: 'Create free account',
    ctaHref: '/auth/signup',
  },
  {
    id: 'regular',
    name: 'Regular',
    price: '$9.99',
    cadence: 'per month',
    description: 'Free events every week. Priority access to the rest.',
    highlights: [
      'Most events included free',
      'Cooking classes at member rates',
      '90-day conversation memory with hosts',
    ],
    ctaLabel: 'Start Regular',
    ctaHref: '/membership?tier=regular',
    featured: true,
  },
  {
    id: 'vip',
    name: 'VIP',
    price: '$24.99',
    cadence: 'per month',
    description: 'Everything. Plus backstage.',
    highlights: [
      'Every event included free',
      'Priority guest Q&A seating',
      '365-day memory + VIP-only rooms',
    ],
    ctaLabel: 'Go VIP',
    ctaHref: '/membership?tier=vip',
  },
]

export function MembershipTeaser() {
  return (
    <section className="py-24 md:py-32 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-2xl mb-16">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Become a Member
          </p>
          <h2 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
            Three ways to join the room.
          </h2>
          <p className="text-base md:text-lg text-muted-foreground font-body mt-4 leading-relaxed">
            Start free — upgrade when you find yourself coming back.
          </p>
        </div>

        {/* Tier grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                'relative flex flex-col rounded-xl border p-8 transition-colors',
                tier.featured
                  ? 'border-primary bg-card'
                  : 'border-border bg-card/50 hover:border-border/80'
              )}
            >
              {tier.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-block px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-body font-semibold tracking-widest uppercase">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="font-heading text-2xl font-bold text-foreground">
                  {tier.name}
                </h3>
                <p className="text-sm text-muted-foreground font-body mt-1">
                  {tier.description}
                </p>
              </div>

              <div className="mb-8">
                <span className="font-heading text-5xl font-bold text-foreground">
                  {tier.price}
                </span>
                <span className="text-sm text-muted-foreground font-body ml-2">
                  {tier.cadence}
                </span>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground font-body">{h}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant={tier.featured ? 'default' : 'outline'}
                className="w-full"
                asChild
              >
                <Link href={tier.ctaHref}>{tier.ctaLabel}</Link>
              </Button>
            </div>
          ))}
        </div>

        {/* Footer link to full page */}
        <p className="text-center text-sm text-muted-foreground font-body mt-12">
          <Link
            href="/membership"
            className="underline hover:text-foreground transition-colors"
          >
            See full feature comparison →
          </Link>
        </p>
      </div>
    </section>
  )
}
