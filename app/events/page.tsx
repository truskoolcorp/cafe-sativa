'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type EventRow = {
  id: string
  slug: string
  title: string
  description: string | null
  series: string | null
  room_id: string
  starts_at: string
  ends_at: string | null
  status: string
  ticket_price_cents: number
  capacity: number | null
  free_for_tiers: string[]
  hero_image_url: string | null
  // from the view only; 'ticketed' | 'free' | 'tier_included' | 'purchase_required'
  access: 'ticketed' | 'free' | 'tier_included' | 'purchase_required'
}

function formatEventDate(iso: string) {
  const d = new Date(iso)
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    date: d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    time: d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  }
}

function formatPrice(cents: number) {
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}

function AccessBadge({ access, freeForTiers }: { access: EventRow['access']; freeForTiers: string[] }) {
  if (access === 'ticketed') {
    return (
      <span className="inline-block rounded-full bg-emerald-900/60 px-3 py-1 text-xs uppercase tracking-wider text-emerald-300">
        You're in
      </span>
    )
  }
  if (access === 'free') {
    return (
      <span className="inline-block rounded-full bg-[#c9a961]/20 px-3 py-1 text-xs uppercase tracking-wider text-[#d2a24c]">
        Free
      </span>
    )
  }
  if (access === 'tier_included') {
    return (
      <span className="inline-block rounded-full bg-[#c9a961]/20 px-3 py-1 text-xs uppercase tracking-wider text-[#d2a24c]">
        Included with your tier
      </span>
    )
  }
  // purchase_required
  if (freeForTiers.length > 0) {
    const upgradeTier = freeForTiers.includes('regular') ? 'Regular+' : 'VIP'
    return (
      <span className="inline-block rounded-full bg-[#8a5a2b]/35 px-3 py-1 text-xs uppercase tracking-wider text-[#f7e7cf]">
        Free with {upgradeTier}
      </span>
    )
  }
  return null
}

function EventsInner() {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const supabase = createClient()
        // my_events_v returns only scheduled/live events for both auth
        // and anon users. The `access` column is personalized — for
        // anon users everything shows as 'free' (if price_cents=0) or
        // 'purchase_required' otherwise.
        const { data, error: viewError } = await supabase
          .from('my_events_v')
          .select(
            'id, slug, title, description, series, room_id, starts_at, ends_at, status, ticket_price_cents, capacity, free_for_tiers, hero_image_url, access'
          )
          .order('starts_at', { ascending: true })

        if (!mounted) return

        if (viewError) {
          console.error('[events] my_events_v read failed', viewError)
          setError('Could not load events.')
        } else {
          setEvents((data as EventRow[]) || [])
        }
      } catch (err) {
        if (mounted) setError('Could not load events.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-[#2a0802] text-[#f7e7cf]">
      <header className="sticky top-0 z-30 border-b border-[#8a5a2b]/35 bg-[#2a0802]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="text-[2rem] font-semibold tracking-tight text-[#d2a24c]">
            Café Sativa
          </Link>

          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/" className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5">
              Home
            </Link>
            <Link
              href="/membership"
              className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5"
            >
              Membership
            </Link>
            <Link
              href="/account"
              className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5"
            >
              Account
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm uppercase tracking-[0.35em] text-[#c9a961]">Events</p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight text-[#d2a24c] md:text-6xl">
            What's on at Café Sativa.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#eadbc7]">
            Live conversations, tastings, and performances streamed from the venue.
            Members get in free — otherwise, tickets below.
          </p>
        </div>

        {loading && (
          <div className="mx-auto mt-14 max-w-4xl space-y-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703]"
              />
            ))}
          </div>
        )}

        {error && (
          <div className="mx-auto mt-14 max-w-2xl rounded-xl bg-red-900/70 px-5 py-4 text-center text-sm text-white">
            {error}
          </div>
        )}

        {!loading && !error && events && events.length === 0 && (
          <div className="mx-auto mt-14 max-w-2xl rounded-2xl border border-[#8a5a2b]/35 bg-[#1f0703] px-6 py-10 text-center">
            <p className="text-[#eadbc7]">
              No events scheduled right now. Check back — we post new dates every week.
            </p>
          </div>
        )}

        {!loading && !error && events && events.length > 0 && (
          <div className="mx-auto mt-14 max-w-4xl space-y-6">
            {events.map((event) => {
              const when = formatEventDate(event.starts_at)
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.slug}`}
                  className="group block rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703] p-8 transition hover:border-[#d2a24c]/45 hover:bg-[#241008]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-[260px]">
                      <div className="flex flex-wrap items-center gap-3">
                        {event.series && (
                          <span className="text-xs uppercase tracking-[0.25em] text-[#c9a961]">
                            {event.series.replace(/-/g, ' ')}
                          </span>
                        )}
                        <AccessBadge
                          access={event.access}
                          freeForTiers={event.free_for_tiers || []}
                        />
                      </div>

                      <h2 className="mt-3 text-3xl font-semibold text-[#d2a24c] group-hover:text-[#e0b866]">
                        {event.title}
                      </h2>

                      <p className="mt-3 text-sm uppercase tracking-[0.15em] text-[#eadbc7]/75">
                        {when.weekday}, {when.date} · {when.time}
                      </p>

                      {event.description && (
                        <p className="mt-4 line-clamp-2 text-base leading-7 text-[#eadbc7]">
                          {event.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <p className="text-3xl font-semibold text-[#d2a24c]">
                        {formatPrice(event.ticket_price_cents)}
                      </p>
                      {event.ticket_price_cents > 0 && (
                        <p className="text-xs uppercase tracking-wider text-[#eadbc7]/60">
                          per ticket
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

function EventsSkeleton() {
  return (
    <main className="min-h-screen bg-[#2a0802]">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="h-4 w-32 mx-auto bg-[#c9a961]/30 rounded animate-pulse" />
        <div className="h-16 mt-6 max-w-2xl mx-auto bg-[#d2a24c]/20 rounded animate-pulse" />
      </div>
    </main>
  )
}

export default function EventsPage() {
  return (
    <Suspense fallback={<EventsSkeleton />}>
      <EventsInner />
    </Suspense>
  )
}
