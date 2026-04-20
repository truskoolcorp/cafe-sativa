'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type PlanType = 'insider' | 'founding'

export default function MembershipPage() {
  const router = useRouter()
  const [authLoaded, setAuthLoaded] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [loadingPlan, setLoadingPlan] = useState<PlanType | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let unsub: (() => void) | null = null

    async function loadAuth() {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()

        if (!mounted) return
        setIsSignedIn(Boolean(data.user))
        setEmail(data.user?.email ?? null)

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!mounted) return
          setIsSignedIn(Boolean(session?.user))
          setEmail(session?.user?.email ?? null)
        })

        unsub = () => subscription.unsubscribe()
      } catch {
        if (mounted) {
          setIsSignedIn(false)
          setEmail(null)
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
  }, [])

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

  async function startCheckout(plan: PlanType) {
    setLoadingPlan(plan)
    setError(null)

    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data?.error || 'Checkout failed.')
        setLoadingPlan(null)
        return
      }

      if (!data?.url) {
        setError('Stripe did not return a checkout link.')
        setLoadingPlan(null)
        return
      }

      window.location.href = data.url
    } catch (err) {
      console.error(err)
      setError('Checkout failed.')
      setLoadingPlan(null)
    }
  }

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
            Café Sativa memberships are designed to reward early believers with access,
            prestige, and first-in-line positioning before the physical venue opens.
          </p>

          {authLoaded && isSignedIn && (
            <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-[#8a5a2b]/35 bg-[#1f0703] px-6 py-4 text-left">
              <p className="text-sm text-[#c9a961]">Signed in as</p>
              <p className="mt-1 text-base text-[#f7e7cf]">{email || 'Authenticated user'}</p>
            </div>
          )}

          {error && (
            <div className="mx-auto mt-8 max-w-2xl rounded-xl bg-red-900/70 px-5 py-4 text-left text-sm text-white">
              {error}
            </div>
          )}
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-8 lg:grid-cols-3">
          <div className="rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703] p-8">
            <p className="text-sm uppercase tracking-[0.25em] text-[#c9a961]">Guest List</p>
            <h2 className="mt-4 text-4xl font-semibold text-[#d2a24c]">Free</h2>
            <p className="mt-5 text-lg leading-8 text-[#eadbc7]">
              Get updates on featured chef drops, runway nights, launch news, and future access opportunities.
            </p>
            <ul className="mt-6 space-y-3 text-[#eadbc7]">
              <li>• Launch updates</li>
              <li>• Public event announcements</li>
              <li>• Featured chef news</li>
              <li>• General community access</li>
            </ul>
            <a
              href="/#guest-list"
              className="mt-8 inline-block rounded-md border border-[#d2a24c]/40 px-6 py-3 font-semibold text-[#f7e7cf] transition hover:bg-white/5"
            >
              Join Free
            </a>
          </div>

          <div className="rounded-3xl border border-[#d2a24c]/45 bg-[#241008] p-8 shadow-2xl shadow-black/30">
            <p className="text-sm uppercase tracking-[0.25em] text-[#c9a961]">Insider</p>
            <h2 className="mt-4 text-4xl font-semibold text-[#d2a24c]">$9.99/mo</h2>
            <p className="mt-5 text-lg leading-8 text-[#eadbc7]">
              Early access to premium drops, curated experiences, and the strongest signal that you were here first.
            </p>
            <ul className="mt-6 space-y-3 text-[#eadbc7]">
              <li>• Early chef drop access</li>
              <li>• Premium event releases</li>
              <li>• Members content</li>
              <li>• Replay library access</li>
            </ul>
            <button
              onClick={() => startCheckout('insider')}
              disabled={loadingPlan === 'insider'}
              className="mt-8 inline-block rounded-md bg-[#d2a24c] px-6 py-3 font-semibold text-[#2a0802] transition hover:bg-[#e0b866] disabled:opacity-50"
            >
              {loadingPlan === 'insider' ? 'Opening Checkout...' : 'Become an Insider'}
            </button>
          </div>

          <div className="rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703] p-8">
            <p className="text-sm uppercase tracking-[0.25em] text-[#c9a961]">Founding Guest</p>
            <h2 className="mt-4 text-4xl font-semibold text-[#d2a24c]">$24.99/mo</h2>
            <p className="mt-5 text-lg leading-8 text-[#eadbc7]">
              Priority status for the supporters getting in before the brand fully materializes in the real world.
            </p>
            <ul className="mt-6 space-y-3 text-[#eadbc7]">
              <li>• Everything in Insider</li>
              <li>• VIP-only digital experiences</li>
              <li>• Future reservation priority</li>
              <li>• Exclusive invites and perks</li>
            </ul>
            <button
              onClick={() => startCheckout('founding')}
              disabled={loadingPlan === 'founding'}
              className="mt-8 inline-block rounded-md bg-[#d2a24c] px-6 py-3 font-semibold text-[#2a0802] transition hover:bg-[#e0b866] disabled:opacity-50"
            >
              {loadingPlan === 'founding' ? 'Opening Checkout...' : 'Claim Founding Status'}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
