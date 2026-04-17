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
      <section className="mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-6 py-20 lg:px-10">
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

            <a
              href="#guest-list"
              className="rounded-md border border-[#f5e6d3]/25 px-8 py-4 text-base font-semibold text-[#f5e6d3] transition hover:bg-white/5"
            >
              Join Guest List
            </a>
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

            {message && (
              <p className="text-sm text-[#f5e6d3]">
                {message}
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  )
}
