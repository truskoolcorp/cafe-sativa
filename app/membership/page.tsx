'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, X, Sparkles, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * /membership — the full tier feature matrix and paid-tier checkout.
 *
 * This page inherits the Navbar and Footer from the root layout, so
 * the prior duplicate <header> is gone. The three pricing cards
 * match the home page's MembershipTeaser visually but add a feature
 * comparison matrix below — this is where visitors go when the
 * teaser on / wasn't enough to close them.
 *
 * Preserved logic from the previous version:
 *
 *  1. Auth state with live subscription — reflects sign-in/out
 *     without reload
 *  2. members_v lookup for current tier + renewal date
 *  3. /auth/signin?redirect=...&intent=<tier> redirect dance —
 *     unauth users clicking a tier bounce through signin and
 *     auto-resume checkout on return
 *  4. Stripe redirect banner via ?success=1&tier=<tier>
 *  5. Cancel banner via ?canceled=1
 *
 * Visual changes:
 *
 *  - Semantic shadcn tokens (primary, card, muted, border) instead
 *    of hardcoded hex
 *  - Featured tier (Regular) marked with a "MOST POPULAR" ribbon
 *    like the home teaser, for consistency
 *  - Feature matrix below the cards — eight feature rows × three
 *    tiers, showing exactly what each tier unlocks, with checkmarks
 *    and × marks for clarity
 */

type Tier = 'regular' | 'vip'

type MembershipState = {
  tier: 'explorer' | 'regular' | 'vip'
  status: 'active' | 'canceled' | 'past_due' | 'incomplete'
  currentPeriodEnd: string | null
}

// ─── Feature matrix data ─────────────────────────────────────────
// The source of truth for what each tier includes. Used both by the
// "highlights" bullets on each card AND by the comparison matrix at
// the bottom. Keeping it in one place means when we add a benefit
// we only edit once.
const FEATURES = [
  {
    label: 'Walk the 3D venue',
    explorer: true,
    regular: true,
    vip: true,
  },
  {
    label: 'Talk to AI hosts (Laviche, Ginger, Ahnika)',
    explorer: 'Single session',
    regular: '90-day memory',
    vip: '365-day memory',
  },
  {
    label: 'Buy individual event tickets',
    explorer: true,
    regular: true,
    vip: true,
  },
  {
    label: 'Most events free',
    explorer: false,
    regular: true,
    vip: true,
  },
  {
    label: 'Every event free',
    explorer: false,
    regular: false,
    vip: true,
  },
  {
    label: 'Priority Q&A seating at guest events',
    explorer: false,
    regular: false,
    vip: true,
  },
  {
    label: 'Cigar Lounge master blender sessions',
    explorer: false,
    regular: false,
    vip: true,
  },
  {
    label: 'Tenerife opening-week priority list',
    explorer: false,
    regular: 'Waitlist',
    vip: 'Reserved',
  },
] as const

type TierKey = 'explorer' | 'regular' | 'vip'

type TierCard = {
  id: TierKey
  name: string
  price: string
  cadence: string
  description: string
  highlights: string[]
  featured?: boolean
}

const TIERS: TierCard[] = [
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
      '90-day conversation memory',
    ],
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
  },
]

function MembershipInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const successTier = searchParams.get('success') === '1' ? searchParams.get('tier') : null
  const wasCanceled = searchParams.get('canceled') === '1'

  const [authLoaded, setAuthLoaded] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [membership, setMembership] = useState<MembershipState | null>(null)
  const [loadingTier, setLoadingTier] = useState<Tier | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load auth + membership state, with live subscription so sign-in
  // from another tab reflects here without a refresh.
  useEffect(() => {
    let mounted = true
    let unsub: (() => void) | null = null

    async function loadAuth() {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()

        if (!mounted) return
        const user = data.user
        setIsSignedIn(Boolean(user))
        setEmail(user?.email ?? null)

        if (user) {
          const { data: memberRow } = await supabase
            .from('members_v')
            .select('tier, status, current_period_end')
            .eq('id', user.id)
            .maybeSingle()

          if (mounted && memberRow) {
            setMembership({
              tier: memberRow.tier,
              status: memberRow.status,
              currentPeriodEnd: memberRow.current_period_end,
            })
          }
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!mounted) return
          setIsSignedIn(Boolean(session?.user))
          setEmail(session?.user?.email ?? null)
        })

        unsub = () => subscription.unsubscribe()
      } catch (err) {
        console.error('Failed to load auth/membership', err)
        if (mounted) {
          setIsSignedIn(false)
          setEmail(null)
          setMembership(null)
        }
      } finally {
        if (mounted) setAuthLoaded(true)
      }
    }

    loadAuth()

    return () => {
      mounted = false
      if (unsub) unsub()
    }
    // Re-run after Stripe redirect so the membership row refreshes
    // (successTier transitions from null → 'regular'/'vip' when we
    // land back here from Stripe).
  }, [successTier])

  async function startCheckout(tier: Tier) {
    setError(null)

    // Not signed in: bounce through signin and come back here.
    // Intent carries the tier so we know what to auto-resume.
    if (!isSignedIn) {
      router.push(
        `/auth/signin?redirect=${encodeURIComponent(`/membership?intent=${tier}`)}`
      )
      return
    }

    setLoadingTier(tier)

    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401 || data?.code === 'not_authenticated') {
        router.push(
          `/auth/signin?redirect=${encodeURIComponent(`/membership?intent=${tier}`)}`
        )
        return
      }

      if (!res.ok) {
        setError(data?.error || 'Checkout failed.')
        setLoadingTier(null)
        return
      }

      if (!data?.url) {
        setError('Stripe did not return a checkout link.')
        setLoadingTier(null)
        return
      }

      window.location.href = data.url
    } catch (err) {
      console.error(err)
      setError('Checkout failed.')
      setLoadingTier(null)
    }
  }

  // Auto-resume checkout when we bounced through signin. The intent
  // param persists through Supabase's auth flow via the redirect URL.
  useEffect(() => {
    const intent = searchParams.get('intent') as Tier | null
    if (authLoaded && isSignedIn && (intent === 'regular' || intent === 'vip')) {
      // Drop the intent param so refresh doesn't re-trigger
      router.replace('/membership')
      startCheckout(intent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded, isSignedIn])

  const currentTierLabel =
    membership?.tier === 'vip'
      ? 'VIP'
      : membership?.tier === 'regular'
        ? 'Regular'
        : membership?.tier === 'explorer'
          ? 'Explorer (free)'
          : null

  const isActiveMember =
    membership &&
    (membership.tier === 'regular' || membership.tier === 'vip') &&
    membership.status === 'active'

  const renewalDate = membership?.currentPeriodEnd
    ? new Date(membership.currentPeriodEnd).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  // Render a feature-matrix cell. Three shapes: boolean → ✓/×,
  // string → small label, everything else → em-dash.
  function featureCell(value: string | boolean) {
    if (value === true) {
      return <Check className="w-4 h-4 text-primary mx-auto" aria-label="Included" />
    }
    if (value === false) {
      return <X className="w-4 h-4 text-muted-foreground/40 mx-auto" aria-label="Not included" />
    }
    return (
      <span className="text-xs text-foreground font-body font-semibold">
        {value}
      </span>
    )
  }

  // Button state + copy for a given tier card. Extracted because
  // the conditional logic is getting knotty (current tier vs
  // downgrade vs upgrade vs first purchase).
  function tierCTA(tier: TierCard) {
    if (tier.id === 'explorer') {
      if (isSignedIn) {
        return (
          <Button variant="outline" className="w-full" disabled>
            {membership?.tier === 'explorer' ? 'Your current tier' : 'Included'}
          </Button>
        )
      }
      return (
        <Button variant="outline" className="w-full" asChild>
          <Link href="/auth/signup">Sign up free</Link>
        </Button>
      )
    }

    const paidTier = tier.id as Tier

    if (isActiveMember && membership?.tier === paidTier) {
      return (
        <Button variant="secondary" className="w-full" disabled>
          Your current plan
        </Button>
      )
    }

    const label =
      loadingTier === paidTier
        ? 'Opening checkout…'
        : membership?.tier === 'vip' && paidTier === 'regular'
          ? 'Downgrade to Regular'
          : membership?.tier === 'regular' && paidTier === 'vip'
            ? 'Upgrade to VIP'
            : paidTier === 'vip'
              ? 'Go VIP'
              : 'Start Regular'

    return (
      <Button
        variant={tier.featured ? 'default' : 'outline'}
        className="w-full"
        onClick={() => startCheckout(paidTier)}
        disabled={loadingTier !== null}
      >
        {label}
      </Button>
    )
  }

  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Membership
          </p>
          <h1 className="font-heading text-5xl md:text-6xl font-bold text-foreground leading-tight">
            Choose how close you want to get.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground font-body mt-6 leading-relaxed">
            Start free — upgrade when you find yourself coming back. All tiers
            include the full venue walkthrough and the ability to talk to our
            AI hosts.
          </p>
        </div>

        {/* Status banners — post-Stripe redirect + signed-in context */}
        <div className="max-w-2xl mx-auto mt-10 space-y-4">
          {successTier && (
            <div className="rounded-xl border border-primary/40 bg-primary/5 px-6 py-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                    Welcome in.
                  </p>
                  <p className="text-sm text-foreground font-body mt-1">
                    Your {successTier === 'vip' ? 'VIP' : 'Regular'} membership
                    is active. Head to your{' '}
                    <Link
                      href="/account"
                      className="underline hover:text-primary transition-colors"
                    >
                      account
                    </Link>{' '}
                    to see the details.
                  </p>
                </div>
              </div>
            </div>
          )}

          {wasCanceled && !successTier && (
            <div className="rounded-xl border border-border bg-card px-6 py-4">
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                Checkout canceled
              </p>
              <p className="text-sm text-foreground font-body mt-1">
                No charge was made. You can still join below whenever
                you&rsquo;re ready.
              </p>
            </div>
          )}

          {authLoaded && isSignedIn && !successTier && currentTierLabel && (
            <div className="rounded-xl border border-border bg-card px-6 py-4">
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                Signed in as
              </p>
              <p className="text-sm text-foreground font-body mt-1">
                {email || 'Authenticated user'}
              </p>
              <p className="text-sm text-muted-foreground font-body mt-2">
                Current tier:{' '}
                <span className="font-semibold text-primary">
                  {currentTierLabel}
                </span>
                {membership?.status === 'past_due' && (
                  <span className="ml-2 text-destructive">
                    · payment past due
                  </span>
                )}
                {membership?.status === 'canceled' && renewalDate && (
                  <span className="ml-2">· access through {renewalDate}</span>
                )}
                {membership?.status === 'active' && renewalDate && (
                  <span className="ml-2">· renews {renewalDate}</span>
                )}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-foreground font-body">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Tier cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                'relative flex flex-col rounded-xl border p-8 transition-colors',
                tier.featured
                  ? 'border-primary bg-card'
                  : 'border-border bg-card/50'
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
                <h2 className="font-heading text-2xl font-bold text-foreground">
                  {tier.name}
                </h2>
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

              {authLoaded ? (
                tierCTA(tier)
              ) : (
                <div className="h-10 rounded-md bg-muted animate-pulse" />
              )}
            </div>
          ))}
        </div>

        {/* Feature comparison matrix */}
        <section className="mt-24">
          <div className="max-w-2xl mb-10">
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground">
              What&rsquo;s in each tier.
            </h2>
            <p className="text-sm text-muted-foreground font-body mt-3">
              Every detail, laid out. You can upgrade or downgrade any time.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left">
              <thead className="bg-card border-b border-border">
                <tr>
                  <th className="py-4 px-4 md:px-6 font-body font-semibold text-xs tracking-widest uppercase text-muted-foreground">
                    Feature
                  </th>
                  <th className="py-4 px-4 md:px-6 text-center font-body font-semibold text-xs tracking-widest uppercase text-muted-foreground w-32">
                    Explorer
                  </th>
                  <th className="py-4 px-4 md:px-6 text-center font-body font-semibold text-xs tracking-widest uppercase text-primary w-32">
                    Regular
                  </th>
                  <th className="py-4 px-4 md:px-6 text-center font-body font-semibold text-xs tracking-widest uppercase text-muted-foreground w-32">
                    VIP
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {FEATURES.map((feature) => (
                  <tr key={feature.label} className="hover:bg-card/30 transition-colors">
                    <td className="py-4 px-4 md:px-6 text-sm text-foreground font-body">
                      {feature.label}
                    </td>
                    <td className="py-4 px-4 md:px-6 text-center">
                      {featureCell(feature.explorer)}
                    </td>
                    <td className="py-4 px-4 md:px-6 text-center bg-primary/5">
                      {featureCell(feature.regular)}
                    </td>
                    <td className="py-4 px-4 md:px-6 text-center">
                      {featureCell(feature.vip)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground font-body text-center mt-6 max-w-2xl mx-auto">
            Prices in USD. Billing via Stripe. Cancel any time from your
            account — access continues through the end of the paid period.
          </p>
        </section>
      </div>
    </div>
  )
}

function MembershipSkeleton() {
  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <div className="h-4 w-32 mx-auto bg-muted rounded animate-pulse" />
          <div className="h-14 bg-muted rounded animate-pulse" />
          <div className="h-6 w-3/4 mx-auto bg-muted/50 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-96 rounded-xl border border-border bg-card/50 animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function MembershipPage() {
  return (
    <Suspense fallback={<MembershipSkeleton />}>
      <MembershipInner />
    </Suspense>
  )
}
