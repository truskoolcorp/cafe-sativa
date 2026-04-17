'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Plan = 'insider' | 'founder'

export default function MembershipPage() {
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('success') === 'true') {
      setNotice('Checkout started successfully.')
    } else if (url.searchParams.get('canceled') === 'true') {
      setNotice('Checkout was canceled.')
    }
  }, [])

  async function handleCheckout(plan: Plan) {
    setLoadingPlan(plan)
    setError(null)

    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.url) {
        setError(data?.error || 'Checkout failed.')
        setLoadingPlan(null)
        return
      }

      window.location.href = data.url
    } catch (err: any) {
      setError(err?.message || 'Checkout failed.')
      setLoadingPlan(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#1a0904] px-6 py-20 text-[#f5e6d3] lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Link href="/" className="rounded-md px-4 py-2 text-[#f5e6d3] hover:bg-white/5">
            ← Back Home
          </Link>
          <Link
            href="/auth/signin"
            className="rounded-md border border-[#c9a961]/25 px-4 py-2 text-[#f5e6d3] hover:bg-white/5"
          >
            Sign In
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-md bg-[#c9a961] px-4 py-2 font-medium text-[#2b1810] hover:bg-[#e2c27a]"
          >
            Create Account
          </Link>
        </div>

        <p className="text-sm uppercase tracking-[0.35em] text-[#c9a961]">
          Membership
        </p>

        <h1 className="mt-4 text-5xl font-semibold text-[#c9a961] md:text-6xl">
          Choose your access level
        </h1>

        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#f5e6d3]/80">
          Start with Insider or secure Founding Guest status for priority access,
          premium drops, and future real-world reservation advantages.
        </p>

        {notice && <p className="mt-6 text-sm text-green-300">{notice}</p>}
        {error && <p className="mt-6 text-sm text-red-300">{error}</p>}

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-[#c9a961]/20 bg-black/20 p-8">
            <h2 className="text-3xl font-semibold text-[#c9a961]">Insider</h2>
            <p className="mt-3 text-4xl font-semibold">$9.99/mo</p>
            <ul className="mt-6 space-y-3 text-[#f5e6d3]/85">
              <li>Early access to featured chef drops</li>
              <li>Members-only releases and updates</li>
              <li>Priority access to digital events</li>
              <li>Founding community perks</li>
            </ul>

            <button
              onClick={() => handleCheckout('insider')}
              disabled={loadingPlan !== null}
              className="mt-8 w-full rounded-md bg-[#c9a961] px-6 py-4 font-semibold text-[#2b1810] transition hover:bg-[#e2c27a] disabled:opacity-50"
            >
              {loadingPlan === 'insider' ? 'Redirecting...' : 'Join Insider'}
            </button>
          </div>

          <div className="rounded-2xl border border-[#c9a961]/20 bg-black/20 p-8">
            <h2 className="text-3xl font-semibold text-[#c9a961]">
              Founding Guest
            </h2>
            <p className="mt-3 text-4xl font-semibold">$24.99/mo</p>
            <ul className="mt-6 space-y-3 text-[#f5e6d3]/85">
              <li>Everything in Insider</li>
              <li>Higher-priority access to drops and events</li>
              <li>Future venue reservation priority</li>
              <li>Exclusive founding-tier perks</li>
            </ul>

            <button
              onClick={() => handleCheckout('founder')}
              disabled={loadingPlan !== null}
              className="mt-8 w-full rounded-md bg-[#c9a961] px-6 py-4 font-semibold text-[#2b1810] transition hover:bg-[#e2c27a] disabled:opacity-50"
            >
              {loadingPlan === 'founder' ? 'Redirecting...' : 'Become Founding Guest'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
