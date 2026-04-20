'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Tier = 'regular' | 'vip'

type MembershipState = {
  tier: 'explorer' | 'regular' | 'vip'
  status: 'active' | 'canceled' | 'past_due' | 'incomplete'
  currentPeriodEnd: string | null
}

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
          // Fetch from the members_v view which joins profiles + memberships
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
  }, [successTier]) // re-run after Stripe redirect so membership row refreshes

  async function handleSignOut() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    } catch (err) {
      console.error('Sign out failed:', err)
    }
  }

  async function startCheckout(tier: Tier) {
    setError(null)

    // If not signed in, bounce through signin and come back here.
    if (!isSignedIn) {
      router.push(`/auth/signin?redirect=${encodeURIComponent(`/membership?intent=${tier}`)}`)
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
        router.push(`/auth/signin?redirect=${encodeURIComponent(`/membership?intent=${tier}`)}`)
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

  // Auto-trigger checkout if we bounced through signin with ?intent=vip etc.
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

  return (
    <main className="min-h-screen bg-[#2a0802] text-[#f7e7cf]">
      <header className="sticky top-0 z-30 border-b border-[#8a5a2b]/35 bg-[#2a0802]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="text-[2rem] font-semibold tracking-tight text-[#d2a24c]">
            Café Sativa
          </Link>

          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/" className="rounded-md px-3 py-2 text-[#f7e7cf] transition hover:bg-white/5">
              Home
            </Link>

            {authLoaded && isSignedIn ? (
              <>
                <Link
                  href="/account"
                  className="rounded-md px-3 py-2 text-[#f7e7cf] transition hover:bg-white/5"
                >
                  Account
                </Link>
                <button
                  onClick={handleSignOut}
                  className="rounded-md bg-[#d2a24c] px-4 py-2 font-medium text-[#2a0802] transition hover:bg-[#e0b866]"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/signin"
                  className="rounded-md px-3 py-2 text-[#f7e7cf] transition hover:bg-white/5"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signup"
                  className="rounded-md bg-[#d2a24c] px-4 py-2 font-medium text-[#2a0802] transition hover:bg-[#e0b866]"
                >
                  Sign Up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm uppercase tracking-[0.35em] text-[#c9a961]">Membership</p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight text-[#d2a24c] md:text-7xl">
            Choose how close you want to get.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-[#eadbc7]">
            Café Sativa memberships reward early believers with access, prestige, and
            first-in-line positioning before the physical venue opens.
          </p>

          {/* Post-Stripe-redirect banners */}
          {successTier && (
            <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-emerald-400/30 bg-emerald-900/40 px-6 py-4 text-left">
              <p className="text-sm uppercase tracking-[0.25em] text-emerald-300">
                Welcome in.
              </p>
              <p className="mt-2 text-base text-[#f7e7cf]">
                Your {successTier === 'vip' ? 'VIP' : 'Regular'} membership is active.
                Head to your <Link href="/account" className="underline">account</Link> to see the details.
              </p>
            </div>
          )}

          {wasCanceled && !successTier && (
            <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-[#c9a961]/30 bg-[#1f0703] px-6 py-4 text-left">
              <p className="text-sm text-[#c9a961]">Checkout canceled.</p>
              <p className="mt-1 text-base text-[#f7e7cf]">
                No charge was made. You can still join below whenever you're ready.
              </p>
            </div>
          )}

          {authLoaded && isSignedIn && !successTier && (
            <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-[#8a5a2b]/35 bg-[#1f0703] px-6 py-4 text-left">
              <p className="text-sm text-[#c9a961]">Signed in as</p>
              <p className="mt-1 text-base text-[#f7e7cf]">{email || 'Authenticated user'}</p>
              {currentTierLabel && (
                <p className="mt-2 text-sm text-[#eadbc7]">
                  Current tier: <span className="font-semibold text-[#d2a24c]">{currentTierLabel}</span>
                  {membership?.status === 'past_due' && (
                    <span className="ml-2 text-amber-300">• payment past due</span>
                  )}
                  {membership?.status === 'canceled' && renewalDate && (
                    <span className="ml-2 text-[#f7e7cf]/70">• access through {renewalDate}</span>
                  )}
                  {membership?.status === 'active' && renewalDate && (
                    <span className="ml-2 text-[#f7e7cf]/70">• renews {renewalDate}</span>
                  )}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="mx-auto mt-8 max-w-2xl rounded-xl bg-red-900/70 px-5 py-4 text-left text-sm text-white">
              {error}
            </div>
          )}
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-8 lg:grid-cols-3">
          {/* Explorer — free */}
          <div className="rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703] p-8">
            <p className="text-sm uppercase tracking-[0.25em] text-[#c9a961]">Explorer</p>
            <h2 className="mt-4 text-4xl font-semibold text-[#d2a24c]">Free</h2>
            <p className="mt-5 text-lg leading-8 text-[#eadbc7]">
              Walk in, look around. Full access to the venue, chat with Laviche, browse events.
              Pay per event at walk-up price.
            </p>
            <ul className="mt-6 space-y-3 text-[#eadbc7]">
              <li>• Venue access (3D and web)</li>
              <li>• Host chat with Laviche</li>
              <li>• Event browsing</li>
              <li>• Event tickets at walk-up price</li>
            </ul>
            {isSignedIn ? (
              <span className="mt-8 inline-block rounded-md border border-[#d2a24c]/40 px-6 py-3 font-semibold text-[#f7e7cf]">
                {membership?.tier === 'explorer' ? 'You are here' : 'Included with any tier'}
              </span>
            ) : (
              <Link
                href="/auth/signup"
                className="mt-8 inline-block rounded-md border border-[#d2a24c]/40 px-6 py-3 font-semibold text-[#f7e7cf] transition hover:bg-white/5"
              >
                Sign Up Free
              </Link>
            )}
          </div>

          {/* Regular — $9.99/mo */}
          <div className="rounded-3xl border border-[#d2a24c]/45 bg-[#241008] p-8 shadow-2xl shadow-black/30">
            <p className="text-sm uppercase tracking-[0.25em] text-[#c9a961]">Regular</p>
            <h2 className="mt-4 text-4xl font-semibold text-[#d2a24c]">$9.99/mo</h2>
            <p className="mt-5 text-lg leading-8 text-[#eadbc7]">
              Make it yours. All events free. 10% off merch. Recordings stay forever.
              Laviche remembers you across visits.
            </p>
            <ul className="mt-6 space-y-3 text-[#eadbc7]">
              <li>• Everything in Explorer</li>
              <li>• Free tickets to all events</li>
              <li>• 10% off merch</li>
              <li>• Event recordings kept forever</li>
              <li>• Host memory: 90 days</li>
            </ul>
            {isActiveMember && membership?.tier === 'regular' ? (
              <span className="mt-8 inline-block rounded-md bg-[#d2a24c]/40 px-6 py-3 font-semibold text-[#f7e7cf]">
                Current plan
              </span>
            ) : (
              <button
                onClick={() => startCheckout('regular')}
                disabled={loadingTier === 'regular'}
                className="mt-8 inline-block rounded-md bg-[#d2a24c] px-6 py-3 font-semibold text-[#2a0802] transition hover:bg-[#e0b866] disabled:opacity-50"
              >
                {loadingTier === 'regular'
                  ? 'Opening Checkout...'
                  : membership?.tier === 'vip'
                    ? 'Downgrade to Regular'
                    : 'Become a Regular'}
              </button>
            )}
          </div>

          {/* VIP — $24.99/mo */}
          <div className="rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703] p-8">
            <p className="text-sm uppercase tracking-[0.25em] text-[#c9a961]">VIP</p>
            <h2 className="mt-4 text-4xl font-semibold text-[#d2a24c]">$24.99/mo</h2>
            <p className="mt-5 text-lg leading-8 text-[#eadbc7]">
              The inner circle. Everything in Regular plus Cigar Lounge, 20% off merch,
              priority ticketing, and first dibs on the Tenerife venue.
            </p>
            <ul className="mt-6 space-y-3 text-[#eadbc7]">
              <li>• Everything in Regular</li>
              <li>• Cigar Lounge access</li>
              <li>• 20% off merch</li>
              <li>• Priority ticketing</li>
              <li>• Tenerife priority list</li>
              <li>• Host memory: 365 days</li>
            </ul>
            {isActiveMember && membership?.tier === 'vip' ? (
              <span className="mt-8 inline-block rounded-md bg-[#d2a24c]/40 px-6 py-3 font-semibold text-[#f7e7cf]">
                Current plan
              </span>
            ) : (
              <button
                onClick={() => startCheckout('vip')}
                disabled={loadingTier === 'vip'}
                className="mt-8 inline-block rounded-md bg-[#d2a24c] px-6 py-3 font-semibold text-[#2a0802] transition hover:bg-[#e0b866] disabled:opacity-50"
              >
                {loadingTier === 'vip' ? 'Opening Checkout...' : 'Claim VIP'}
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function MembershipSkeleton() {
  return (
    <main className="min-h-screen bg-[#2a0802]">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="h-4 w-32 mx-auto bg-[#c9a961]/30 rounded animate-pulse" />
          <div className="h-16 mt-6 bg-[#d2a24c]/20 rounded animate-pulse" />
        </div>
      </div>
    </main>
  )
}

export default function MembershipPage() {
  return (
    <Suspense fallback={<MembershipSkeleton />}>
      <MembershipInner />
    </Suspense>
  )
}
