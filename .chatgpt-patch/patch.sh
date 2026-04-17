#!/usr/bin/env bash
set -euo pipefail

mkdir -p app
mkdir -p app/auth/signin
mkdir -p app/auth/signup
mkdir -p app/membership
mkdir -p app/api/create-checkout-session
mkdir -p lib/supabase

cat > lib/supabase/client.ts <<'EOF'
import { createBrowserClient } from '@supabase/ssr'

let browserClient: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }

  return browserClient
}
EOF

cat > middleware.ts <<'EOF'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
EOF

cat > app/page.tsx <<'EOF'
'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function HomePage() {
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleWaitlistSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)

    const payload = {
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      interest: formData.get('interest'),
    }

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setMessage(data?.error || 'Unable to join the guest list right now.')
        setSubmitting(false)
        return
      }

      setMessage('You’re on the guest list.')
      e.currentTarget.reset()
    } catch {
      setMessage('Network error. Please try again.')
    }

    setSubmitting(false)
  }

  return (
    <main className="min-h-screen bg-[#1a0904] text-[#f5e6d3]">
      <header className="sticky top-0 z-20 border-b border-[#c9a961]/15 bg-[#1a0904]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
          <Link href="/" className="text-xl font-semibold text-[#c9a961]">
            Café Sativa
          </Link>

          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5"
            >
              Home
            </Link>
            <Link
              href="/membership"
              className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5"
            >
              Membership
            </Link>
            <Link
              href="/auth/signin"
              className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5"
            >
              Sign In
            </Link>
            <Link
              href="/auth/signup"
              className="rounded-md bg-[#c9a961] px-4 py-2 font-medium text-[#2b1810] transition hover:bg-[#e2c27a]"
            >
              Sign Up
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-73px)] max-w-7xl flex-col justify-center px-6 py-20 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[#c9a961]">
            Café Sativa
          </p>

          <h1 className="text-5xl font-semibold leading-tight text-[#c9a961] md:text-7xl">
            Sip. Smoke. Vibe.
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-[#f5e6d3]/85 md:text-xl">
            A virtual-first hospitality platform blending culture, cuisine,
            fashion, music, lounge energy, featured chef drops, and premium
            member experiences before the physical venue opens.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/membership"
              className="rounded-md bg-[#c9a961] px-8 py-4 text-base font-semibold text-[#2b1810] transition hover:bg-[#e2c27a]"
            >
              View Membership
            </Link>

            <Link
              href="/auth/signin"
              className="rounded-md border border-[#c9a961] px-8 py-4 text-base font-semibold text-[#f5e6d3] transition hover:bg-[#c9a961]/10"
            >
              Sign In
            </Link>

            <Link
              href="/auth/signup"
              className="rounded-md border border-[#f5e6d3]/25 px-8 py-4 text-base font-semibold text-[#f5e6d3] transition hover:bg-white/5"
            >
              Create Account
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-6xl gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-[#c9a961]/20 bg-black/20 p-6">
            <h2 className="text-2xl font-semibold text-[#c9a961]">
              Featured Chef Series
            </h2>
            <p className="mt-3 leading-7 text-[#f5e6d3]/80">
              Rotating chef drops, tasting experiences, and culinary storytelling
              designed to build prestige and demand before the physical buildout.
            </p>
          </div>

          <div className="rounded-2xl border border-[#c9a961]/20 bg-black/20 p-6">
            <h2 className="text-2xl font-semibold text-[#c9a961]">
              Lounge & Culture
            </h2>
            <p className="mt-3 leading-7 text-[#f5e6d3]/80">
              A premium members-first ecosystem with music, visual culture,
              smoke-friendly atmosphere, and exclusive community experiences.
            </p>
          </div>

          <div className="rounded-2xl border border-[#c9a961]/20 bg-black/20 p-6">
            <h2 className="text-2xl font-semibold text-[#c9a961]">
              Runway & Events
            </h2>
            <p className="mt-3 leading-7 text-[#f5e6d3]/80">
              Fashion-forward programming, digital drops, and immersive brand
              moments that later translate into real-world event revenue.
            </p>
          </div>
        </div>

        <div
          id="guest-list"
          className="mx-auto mt-20 w-full max-w-3xl rounded-2xl border border-[#c9a961]/20 bg-black/20 p-8"
        >
          <h2 className="text-3xl font-semibold text-[#c9a961]">
            Join the Guest List
          </h2>
          <p className="mt-3 text-[#f5e6d3]/80">
            Get updates on featured chefs, memberships, runway nights, Cold
            Stoned drops, and launch events.
          </p>

          <form onSubmit={handleWaitlistSubmit} className="mt-8 space-y-4">
            <input
              name="name"
              required
              placeholder="Full name"
              className="w-full rounded-md border border-[#c9a961]/25 bg-[#2b1810] px-4 py-3 text-white placeholder:text-white/40"
            />

            <input
              name="email"
              type="email"
              required
              placeholder="Email address"
              className="w-full rounded-md border border-[#c9a961]/25 bg-[#2b1810] px-4 py-3 text-white placeholder:text-white/40"
            />

            <input
              name="phone"
              placeholder="Phone (optional)"
              className="w-full rounded-md border border-[#c9a961]/25 bg-[#2b1810] px-4 py-3 text-white placeholder:text-white/40"
            />

            <select
              name="interest"
              className="w-full rounded-md border border-[#c9a961]/25 bg-[#2b1810] px-4 py-3 text-white"
              defaultValue="Membership updates"
            >
              <option>Membership updates</option>
              <option>Featured chef drops</option>
              <option>Runway nights</option>
              <option>Cold Stoned releases</option>
              <option>Opening updates</option>
            </select>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-[#c9a961] px-6 py-4 font-semibold text-[#2b1810] transition hover:bg-[#e2c27a] disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Join the Guest List'}
            </button>

            {message && <p className="text-sm text-[#f5e6d3]">{message}</p>}
          </form>
        </div>
      </section>
    </main>
  )
}
EOF

cat > app/membership/page.tsx <<'EOF'
'use client'

import { useState } from 'react'
import Link from 'next/link'

type Plan = 'insider' | 'founder'

export default function MembershipPage() {
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    } catch {
      setError('Checkout failed.')
      setLoadingPlan(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#1a0904] px-6 py-20 text-[#f5e6d3] lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="rounded-md px-4 py-2 text-[#f5e6d3] hover:bg-white/5"
          >
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

        {error && <p className="mt-6 text-sm text-red-300">{error}</p>}
      </div>
    </main>
  )
}
EOF

cat > app/auth/signin/page.tsx <<'EOF'
'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignInPage() {
  const router = useRouter()

  const [mounted, setMounted] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const supabase = useMemo(() => {
    if (!mounted) return null

    try {
      return createClient()
    } catch (err) {
      console.error(err)
      return null
    }
  }, [mounted])

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (!supabase) {
      setError(
        'Supabase is not configured for this deployment yet. Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy.'
      )
      setLoading(false)
      return
    }

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(signInError.message)
        setLoading(false)
        return
      }

      router.push('/')
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed.')
    }

    setLoading(false)
  }

  if (!mounted) return null

  return (
    <main className="min-h-screen bg-[#2B1810] flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full bg-[#5C4033] rounded-lg p-8 border border-[#C9A961]">
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          <Link href="/" className="text-[#F5E6D3] hover:underline">
            ← Home
          </Link>
          <span className="text-[#c9a961]/50">•</span>
          <Link href="/membership" className="text-[#F5E6D3] hover:underline">
            Membership
          </Link>
          <span className="text-[#c9a961]/50">•</span>
          <Link href="/auth/signup" className="text-[#C9A961] hover:underline">
            Sign Up
          </Link>
        </div>

        <div className="text-center mb-8">
          <span className="text-4xl">☕</span>
          <h1 className="text-[#C9A961] text-3xl font-serif mt-4">
            Sign in to Café Sativa
          </h1>
        </div>

        {!supabase && (
          <div className="bg-yellow-900 text-white p-3 rounded mb-6 text-sm">
            Supabase is not configured for this deployment yet. Check
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
            Vercel, then redeploy.
          </div>
        )}

        {error && (
          <div className="bg-red-900 text-white p-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-6">
          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="you@email.com"
            />
          </div>

          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !supabase}
            className="w-full bg-[#C9A961] text-[#2B1810] py-4 rounded font-semibold hover:bg-[#F5E6D3] transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-[#F5E6D3] text-sm">
            Don’t have an account?{' '}
            <Link href="/auth/signup" className="text-[#C9A961] hover:underline">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
EOF

cat > app/auth/signup/page.tsx <<'EOF'
'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignUpPage() {
  const router = useRouter()

  const [mounted, setMounted] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const supabase = useMemo(() => {
    if (!mounted) return null

    try {
      return createClient()
    } catch (err) {
      console.error(err)
      return null
    }
  }, [mounted])

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (!supabase) {
      setError(
        'Supabase is not configured for this deployment yet. Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy.'
      )
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      setMessage(
        'Account created. Check your email for a confirmation link if email verification is enabled.'
      )

      setTimeout(() => {
        router.push('/auth/signin')
      }, 1500)
    } catch (err: any) {
      setError(err?.message || 'Sign-up failed.')
    }

    setLoading(false)
  }

  if (!mounted) return null

  return (
    <main className="min-h-screen bg-[#2B1810] flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full bg-[#5C4033] rounded-lg p-8 border border-[#C9A961]">
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          <Link href="/" className="text-[#F5E6D3] hover:underline">
            ← Home
          </Link>
          <span className="text-[#c9a961]/50">•</span>
          <Link href="/membership" className="text-[#F5E6D3] hover:underline">
            Membership
          </Link>
          <span className="text-[#c9a961]/50">•</span>
          <Link href="/auth/signin" className="text-[#C9A961] hover:underline">
            Sign In
          </Link>
        </div>

        <div className="text-center mb-8">
          <span className="text-4xl">☕</span>
          <h1 className="text-[#C9A961] text-3xl font-serif mt-4">
            Create your Café Sativa account
          </h1>
        </div>

        {!supabase && (
          <div className="bg-yellow-900 text-white p-3 rounded mb-6 text-sm">
            Supabase is not configured for this deployment yet. Check
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
            Vercel, then redeploy.
          </div>
        )}

        {error && (
          <div className="bg-red-900 text-white p-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        {message && (
          <div className="bg-green-900 text-white p-3 rounded mb-6 text-sm">
            {message}
          </div>
        )}

        <form onSubmit={handleSignUp} className="space-y-6">
          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="you@email.com"
            />
          </div>

          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="Create password"
            />
          </div>

          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="Confirm password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !supabase}
            className="w-full bg-[#C9A961] text-[#2B1810] py-4 rounded font-semibold hover:bg-[#F5E6D3] transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-[#F5E6D3] text-sm">
            Already have an account?{' '}
            <Link href="/auth/signin" className="text-[#C9A961] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
EOF

cat > app/api/create-checkout-session/route.ts <<'EOF'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'

type Plan = 'insider' | 'founder'

export async function POST(req: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

    if (!stripeSecretKey) {
      return NextResponse.json(
        { error: 'STRIPE_SECRET_KEY is not configured.' },
        { status: 500 }
      )
    }

    if (!siteUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SITE_URL is not configured.' },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => null)
    const plan = body?.plan as Plan | undefined

    if (plan !== 'insider' && plan !== 'founder') {
      return NextResponse.json(
        { error: 'Invalid plan selected.' },
        { status: 400 }
      )
    }

    const priceId =
      plan === 'founder'
        ? process.env.STRIPE_PRICE_FOUNDING
        : process.env.STRIPE_PRICE_INSIDER

    if (!priceId) {
      return NextResponse.json(
        { error: `Stripe price ID missing for ${plan}.` },
        { status: 500 }
      )
    }

    const stripe = new Stripe(stripeSecretKey)

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/membership?success=true`,
      cancel_url: `${siteUrl}/membership?canceled=true`,
    })

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe did not return a checkout URL.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('create-checkout-session error:', error)
    return NextResponse.json(
      { error: 'Checkout failed.' },
      { status: 500 }
    )
  }
}
EOF

echo "Patch applied successfully."
