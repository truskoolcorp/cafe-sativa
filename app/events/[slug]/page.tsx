'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
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
  access: 'ticketed' | 'free' | 'tier_included' | 'purchase_required'
}

type MemberState = {
  tier: 'explorer' | 'regular' | 'vip'
  status: string
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

function EventDetailInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams<{ slug: string }>()
  const slug = params?.slug

  const successParam = searchParams.get('success') === '1'
  const wasCanceled = searchParams.get('canceled') === '1'

  const [event, setEvent] = useState<EventRow | null>(null)
  const [member, setMember] = useState<MemberState | null>(null)
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [claimLoading, setClaimLoading] = useState(false)
  const [claimSuccess, setClaimSuccess] = useState(false)

  useEffect(() => {
    let mounted = true

    async function load() {
      if (!slug) return
      try {
        const supabase = createClient()

        // my_events_v is the scoped + personalized view. Order here doesn't
        // matter since we filter by slug.
        const { data: eventRow, error: eventError } = await supabase
          .from('my_events_v')
          .select(
            'id, slug, title, description, series, room_id, starts_at, ends_at, status, ticket_price_cents, capacity, free_for_tiers, hero_image_url, access'
          )
          .eq('slug', slug)
          .maybeSingle()

        if (!mounted) return

        if (eventError) {
          console.error('[event-detail] view read failed', eventError)
          setError('Could not load this event.')
          return
        }

        if (!eventRow) {
          setError('Event not found.')
          return
        }

        setEvent(eventRow as EventRow)

        // Auth + membership load
        const { data: userData } = await supabase.auth.getUser()
        if (userData?.user) {
          setIsSignedIn(true)
          const { data: memRow } = await supabase
            .from('members_v')
            .select('tier, status')
            .eq('id', userData.user.id)
            .maybeSingle()
          if (memRow && mounted) {
            setMember(memRow as MemberState)
          }
        } else {
          setIsSignedIn(false)
        }
      } catch (err) {
        if (mounted) setError('Could not load this event.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [slug, successParam])

  async function handleGetTicket() {
    if (!event) return
    setError(null)

    // Not signed in → bounce through signin with intent to return here
    if (!isSignedIn) {
      router.push(
        `/auth/signin?redirect=${encodeURIComponent(`/events/${event.slug}?intent=ticket`)}`
      )
      return
    }

    setClaimLoading(true)

    try {
      const res = await fetch('/api/create-ticket-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: event.id }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401 || data?.code === 'not_authenticated') {
        router.push(
          `/auth/signin?redirect=${encodeURIComponent(`/events/${event.slug}?intent=ticket`)}`
        )
        return
      }

      if (!res.ok) {
        setError(data?.error || 'Could not get ticket.')
        setClaimLoading(false)
        return
      }

      // Two possible success paths:
      //   1. Free-via-tier grant: server returns { granted: true }
      //      (no redirect — refresh data instead)
      //   2. Paid checkout: server returns { url }
      if (data.granted) {
        setClaimSuccess(true)
        setClaimLoading(false)
        // Refresh event data so 'You're in' badge appears
        router.refresh()
        // Manual reload of local state so the UI updates immediately
        setEvent((prev) => (prev ? { ...prev, access: 'ticketed' } : prev))
        return
      }

      if (data.url) {
        window.location.href = data.url
        return
      }

      setError('Unexpected response from server.')
      setClaimLoading(false)
    } catch (err) {
      console.error(err)
      setError('Could not get ticket.')
      setClaimLoading(false)
    }
  }

  // Auto-resume ticket flow if user bounced through signin
  useEffect(() => {
    const intent = searchParams.get('intent')
    if (!loading && event && isSignedIn && intent === 'ticket') {
      router.replace(`/events/${event.slug}`)
      handleGetTicket()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, event, isSignedIn])

  if (loading) {
    return (
      <main className="min-h-screen bg-[#2a0802]">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:px-10">
          <div className="h-8 w-48 bg-[#c9a961]/20 rounded animate-pulse" />
          <div className="mt-8 h-96 bg-[#1f0703] rounded-3xl animate-pulse" />
        </div>
      </main>
    )
  }

  if (error || !event) {
    return (
      <main className="min-h-screen bg-[#2a0802] text-[#f7e7cf]">
        <div className="mx-auto max-w-4xl px-6 py-20 lg:px-10 text-center">
          <p className="text-sm uppercase tracking-[0.35em] text-[#c9a961]">Event</p>
          <h1 className="mt-4 text-4xl font-semibold text-[#d2a24c]">
            {error || 'Event not found'}
          </h1>
          <Link
            href="/events"
            className="mt-8 inline-block rounded-md border border-[#c9a961]/40 px-6 py-3 text-sm hover:bg-white/5"
          >
            ← Back to all events
          </Link>
        </div>
      </main>
    )
  }

  const when = formatEventDate(event.starts_at)
  const userTier = member?.tier || 'explorer'
  const tierIncludes = event.free_for_tiers?.includes(userTier)

  // Ticket CTA copy depends on auth state + tier + current access
  let ctaLabel: string
  let ctaDisabled = claimLoading
  let ctaHint: string | null = null

  if (event.access === 'ticketed' || claimSuccess) {
    ctaLabel = "You're in"
    ctaDisabled = true
  } else if (event.ticket_price_cents === 0) {
    ctaLabel = claimLoading ? 'Confirming...' : 'RSVP (free)'
  } else if (!isSignedIn) {
    ctaLabel = `Get ticket — ${formatPrice(event.ticket_price_cents)}`
    ctaHint = 'You\u2019ll sign in first, then we\u2019ll pick up where you left off.'
  } else if (tierIncludes) {
    ctaLabel = claimLoading ? 'Claiming...' : 'Claim free ticket'
    ctaHint = `Your ${userTier === 'vip' ? 'VIP' : 'Regular'} membership covers this.`
  } else {
    ctaLabel = claimLoading
      ? 'Opening Checkout...'
      : `Get ticket — ${formatPrice(event.ticket_price_cents)}`
    if (event.free_for_tiers?.length > 0) {
      const upgradeTo = event.free_for_tiers.includes('regular') ? 'Regular' : 'VIP'
      ctaHint = `Or upgrade to ${upgradeTo} and attend free.`
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
            <Link href="/events" className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5">
              All events
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

      <section className="mx-auto max-w-4xl px-6 py-16 lg:px-10">
        {successParam && (
          <div className="mb-8 rounded-2xl border border-emerald-400/30 bg-emerald-900/40 px-6 py-4">
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-300">
              Ticket confirmed.
            </p>
            <p className="mt-2 text-base text-[#f7e7cf]">
              Your ticket for {event.title} is on its way. Check your email for
              the Zoom link.
            </p>
          </div>
        )}

        {wasCanceled && !successParam && (
          <div className="mb-8 rounded-2xl border border-[#c9a961]/30 bg-[#1f0703] px-6 py-4">
            <p className="text-sm text-[#c9a961]">Checkout canceled.</p>
            <p className="mt-1 text-base text-[#f7e7cf]">
              No charge. You can still get a ticket below.
            </p>
          </div>
        )}

        <Link
          href="/events"
          className="inline-block text-sm text-[#eadbc7]/75 hover:text-[#f7e7cf]"
        >
          ← All events
        </Link>

        <div className="mt-6">
          {event.series && (
            <p className="text-xs uppercase tracking-[0.25em] text-[#c9a961]">
              {event.series.replace(/-/g, ' ')}
            </p>
          )}
          <h1 className="mt-3 text-5xl font-semibold leading-tight text-[#d2a24c] md:text-6xl">
            {event.title}
          </h1>

          <p className="mt-6 text-lg uppercase tracking-[0.15em] text-[#eadbc7]/90">
            {when.weekday}, {when.date}
          </p>
          <p className="mt-1 text-lg text-[#eadbc7]/75">{when.time}</p>
        </div>

        {event.description && (
          <div className="mt-10 rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703] p-8">
            <p className="text-lg leading-8 text-[#eadbc7] whitespace-pre-wrap">
              {event.description}
            </p>
          </div>
        )}

        <div className="mt-10 rounded-3xl border border-[#d2a24c]/45 bg-[#241008] p-8 shadow-2xl shadow-black/30">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-[#c9a961]">Ticket</p>
              <p className="mt-2 text-4xl font-semibold text-[#d2a24c]">
                {formatPrice(event.ticket_price_cents)}
              </p>
            </div>
            {event.capacity && (
              <p className="text-sm text-[#eadbc7]/70">Capacity: {event.capacity}</p>
            )}
          </div>

          {error && (
            <div className="mt-5 rounded-xl bg-red-900/70 px-4 py-3 text-sm text-white">
              {error}
            </div>
          )}

          <button
            onClick={handleGetTicket}
            disabled={ctaDisabled}
            className="mt-6 w-full rounded-md bg-[#d2a24c] px-6 py-4 text-base font-semibold text-[#2a0802] transition hover:bg-[#e0b866] disabled:opacity-60"
          >
            {ctaLabel}
          </button>

          {ctaHint && (
            <p className="mt-3 text-sm text-[#eadbc7]/75">{ctaHint}</p>
          )}

          {!tierIncludes &&
            event.free_for_tiers?.length > 0 &&
            event.access === 'purchase_required' && (
              <Link
                href="/membership"
                className="mt-3 inline-block text-sm text-[#c9a961] hover:text-[#e0b866] hover:underline"
              >
                See membership options →
              </Link>
            )}
        </div>
      </section>
    </main>
  )
}

export default function EventDetailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#2a0802]">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:px-10">
            <div className="h-96 bg-[#1f0703] rounded-3xl animate-pulse" />
          </div>
        </main>
      }
    >
      <EventDetailInner />
    </Suspense>
  )
}
