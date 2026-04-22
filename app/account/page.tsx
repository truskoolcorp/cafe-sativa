'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Calendar,
  Crown,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/**
 * /account — the authenticated-user dashboard.
 *
 * Shows the current tier, subscription status, renewal/cancel
 * date, staff/admin flags, and lets the visitor upgrade or sign
 * out. Kept deliberately minimal — no ticket history list yet
 * (that's a follow-up feature; this turn is visual-only).
 *
 * Logic preserved verbatim from the pre-restyle version:
 *  - Route-guard: unauthenticated visitors get redirected to
 *    /auth/signin?redirect=/account (then bounce back here)
 *  - members_v fallback: if the view row hasn't materialized yet
 *    (trigger race on first signup), show defaults for explorer
 *  - Sign-out clears the Supabase session and routes home
 */

type MembershipState = {
  tier: 'explorer' | 'regular' | 'vip'
  status: 'active' | 'canceled' | 'past_due' | 'incomplete'
  currentPeriodEnd: string | null
  isStaff: boolean
  isAdmin: boolean
  displayName: string | null
}

export default function AccountPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [membership, setMembership] = useState<MembershipState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadUser() {
      try {
        const supabase = createClient()
        const { data, error: userError } = await supabase.auth.getUser()

        if (userError || !data.user) {
          router.push('/auth/signin?redirect=/account')
          return
        }

        setEmail(data.user.email ?? null)

        const { data: memberRow, error: memberError } = await supabase
          .from('members_v')
          .select(
            'tier, status, current_period_end, is_staff, is_admin, display_name'
          )
          .eq('id', data.user.id)
          .maybeSingle()

        if (memberError) {
          console.warn('members_v read failed:', memberError)
        }

        if (memberRow) {
          setMembership({
            tier: memberRow.tier,
            status: memberRow.status,
            currentPeriodEnd: memberRow.current_period_end,
            isStaff: memberRow.is_staff,
            isAdmin: memberRow.is_admin,
            displayName: memberRow.display_name,
          })
        } else {
          // Profile row hasn't materialized yet (fresh signup).
          // Default to explorer until the DB trigger completes.
          setMembership({
            tier: 'explorer',
            status: 'active',
            currentPeriodEnd: null,
            isStaff: false,
            isAdmin: false,
            displayName: null,
          })
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load account.')
      } finally {
        setLoading(false)
      }
    }

    loadUser()
  }, [router])

  async function handleSignOut() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Sign out failed.')
    }
  }

  const tierLabel =
    membership?.tier === 'vip'
      ? 'VIP'
      : membership?.tier === 'regular'
        ? 'Regular'
        : 'Explorer'

  const statusLabel =
    membership?.status === 'past_due'
      ? 'Payment past due'
      : membership?.status === 'canceled'
        ? 'Canceled'
        : membership?.status === 'incomplete'
          ? 'Incomplete'
          : 'Active'

  const renewalDate = membership?.currentPeriodEnd
    ? new Date(membership.currentPeriodEnd).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  const tierDescription =
    membership?.tier === 'vip'
      ? 'Every event free, priority Q&A seating, 365-day host memory, Cigar Lounge master blender sessions, and the Tenerife opening-week priority list.'
      : membership?.tier === 'regular'
        ? 'Most events included free, cooking classes at member rates, 90-day host memory, and Tenerife waitlist.'
        : 'Browse the full venue, chat with our AI hosts, and buy tickets à la carte. Upgrade for free tickets to most events.'

  // Decide which icon marks the tier header. Crown for VIP,
  // Sparkles for Regular, UserCircle for Explorer.
  const TierIcon =
    membership?.tier === 'vip'
      ? Crown
      : membership?.tier === 'regular'
        ? Sparkles
        : UserCircle

  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page header */}
        <div className="mb-12">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Account
          </p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
              {membership?.displayName
                ? `Welcome back, ${membership.displayName}.`
                : 'Welcome back.'}
            </h1>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </Button>
          </div>
        </div>

        {loading && (
          <div className="space-y-6">
            <div className="h-32 rounded-xl border border-border bg-card/50 animate-pulse" />
            <div className="h-48 rounded-xl border border-border bg-card/50 animate-pulse" />
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

        {!loading && !error && membership && (
          <div className="space-y-6">
            {/* Identity card */}
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                    Signed in as
                  </p>
                  <p className="font-heading text-lg font-bold text-foreground mt-1">
                    {email || 'Unknown user'}
                  </p>
                </div>
                {(membership.isStaff || membership.isAdmin) && (
                  <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                      {membership.isAdmin ? 'Admin' : 'Staff'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Membership card */}
            <div className="rounded-xl border border-primary/40 bg-card p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                  <TierIcon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                      Current tier
                    </p>
                    <Badge
                      variant={
                        membership.status === 'past_due'
                          ? 'destructive'
                          : 'outline'
                      }
                      className="font-body"
                    >
                      {statusLabel}
                    </Badge>
                  </div>
                  <h2 className="font-heading text-3xl font-bold text-foreground">
                    {tierLabel}
                  </h2>
                  <p className="text-sm text-muted-foreground font-body mt-3 leading-relaxed">
                    {tierDescription}
                  </p>

                  {renewalDate && (
                    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground font-body">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span>
                        {membership.status === 'canceled'
                          ? 'Access through '
                          : 'Renews '}
                        <span className="text-foreground font-semibold">
                          {renewalDate}
                        </span>
                      </span>
                    </div>
                  )}

                  {membership.status === 'past_due' && (
                    <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
                      <p className="text-sm text-foreground font-body">
                        Your last payment didn&rsquo;t go through. Update your
                        payment method to restore access.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-6 pt-6 border-t border-border flex flex-wrap gap-3">
                {membership.tier === 'explorer' && (
                  <Button asChild>
                    <Link href="/membership">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Upgrade to Regular
                    </Link>
                  </Button>
                )}
                {membership.tier === 'regular' && (
                  <Button asChild>
                    <Link href="/membership?intent=vip">
                      <Crown className="w-4 h-4 mr-2" />
                      Upgrade to VIP
                    </Link>
                  </Button>
                )}
                {membership.tier !== 'explorer' && (
                  <Button variant="outline" asChild>
                    <Link href="/membership">
                      <Settings className="w-4 h-4 mr-2" />
                      Manage subscription
                    </Link>
                  </Button>
                )}
                <Button variant="ghost" asChild>
                  <Link href="/events">Browse events →</Link>
                </Button>
              </div>
            </div>

            {/* Quick-links row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link
                href="/events"
                className="group rounded-xl border border-border bg-card/50 p-5 hover:border-primary/40 hover:bg-card transition-colors"
              >
                <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-2">
                  Events
                </p>
                <p className="font-heading text-base font-bold text-foreground group-hover:text-primary transition-colors">
                  Browse the schedule
                </p>
              </Link>
              <Link
                href="/ask"
                className="group rounded-xl border border-border bg-card/50 p-5 hover:border-primary/40 hover:bg-card transition-colors"
              >
                <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-2">
                  Talk to a host
                </p>
                <p className="font-heading text-base font-bold text-foreground group-hover:text-primary transition-colors">
                  Laviche, Ginger, or Ahnika
                </p>
              </Link>
              <Link
                href="/contact"
                className="group rounded-xl border border-border bg-card/50 p-5 hover:border-primary/40 hover:bg-card transition-colors"
              >
                <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-2">
                  Need help?
                </p>
                <p className="font-heading text-base font-bold text-foreground group-hover:text-primary transition-colors">
                  Contact us
                </p>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
