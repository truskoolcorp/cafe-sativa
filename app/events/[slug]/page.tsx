'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import Image from 'next/image'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * /events/[slug] — event detail + ticket purchase page.
 *
 * This is a client component because it owns the entire ticket
 * flow:
 *   1. Load the event via `my_events_v` (which gives us the
 *      personalized `access` column and RLS-safe ticket state)
 *   2. Check auth + membership so we can choose the right CTA copy
 *   3. On "Get ticket":
 *      - Unauthenticated → bounce to /auth/signin with an intent
 *        parameter so we can auto-resume on return
 *      - Tier-included or free event → server grants via insert,
 *        no Stripe roundtrip, page flips to "You're in" immediately
 *      - Paid → Stripe Checkout redirect; user returns with
 *        ?success=1 or ?canceled=1
 *
 * All of that logic is carried over verbatim from the pre-restyle
 * version — the only changes in this file are visual. Broken logic
 * during a restyle is the worst kind of regression.
 */

// Extend EventRow with the new schema fields. We don't import from
// lib/events because that's a server-only helper (it imports next/
// headers). Keeping a client-side copy of the shape is the trade-off.
type EventRow = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  series: string | null
  category:
    | 'stage'
    | 'kitchen'
    | 'cigar_lounge'
    | 'bar'
    | 'gallery'
    | 'community'
    | null
  room_id: string
  presenter_name: string | null
  presenter_role: string | null
  starts_at: string
  ends_at: string | null
  status: string
  ticket_price_cents: number
  capacity: number | null
  free_for_tiers: string[]
  hero_image_url: string | null
  is_featured: boolean
  access: 'ticketed' | 'free' | 'tier_included' | 'purchase_required'
}

type MemberState = {
  tier: 'explorer' | 'regular' | 'vip'
  status: string
}

// Category → human label for the badge on the page. Keep the
// English labels in sync with /events filter chips and the home
// This Week list (we use categoryLabel in multiple places —
// consider extracting to lib/events if it keeps growing).
function categoryLabel(category: EventRow['category']): string {
  switch (category) {
    case 'stage':
      return 'The Stage'
    case 'kitchen':
      return 'The Kitchen'
    case 'cigar_lounge':
      return 'Cigar Lounge'
    case 'bar':
      return 'The Bar'
    case 'gallery':
      return 'The Gallery'
    case 'community':
      return 'Community'
    default:
      return 'Café Sativa'
  }
}

// Category → fallback hero image. Matches the set used by
// EventCard so the list → detail transition feels continuous.
const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  stage: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1920&q=80',
  kitchen: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1920&q=80',
  cigar_lounge:
    'https://images.unsplash.com/photo-1574068468668-a05a11f871da?w=1920&q=80',
  bar: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=1920&q=80',
  gallery:
    'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=1920&q=80',
  community:
    'https://images.unsplash.com/photo-1542044896530-05d85be9b11a?w=1920&q=80',
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

        const { data: eventRow, error: eventError } = await supabase
          .from('my_events_v')
          .select(
            'id, slug, title, subtitle, description, series, category, room_id, presenter_name, presenter_role, starts_at, ends_at, status, ticket_price_cents, capacity, free_for_tiers, hero_image_url, is_featured, access'
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

      if (data.granted) {
        setClaimSuccess(true)
        setClaimLoading(false)
        router.refresh()
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
      <div className="pt-24 pb-16 bg-background min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="h-6 w-32 bg-muted rounded animate-pulse" />
          <div className="h-64 w-full rounded-xl bg-muted animate-pulse" />
          <div className="h-12 w-3/4 bg-muted rounded animate-pulse" />
          <div className="h-48 w-full rounded-xl bg-muted animate-pulse" />
        </div>
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="pt-24 pb-16 bg-background min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center py-16">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Event
          </p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground">
            {error || 'Event not found'}
          </h1>
          <div className="mt-8">
            <Button variant="outline" asChild>
              <Link href="/events">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to all events
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const when = formatEventDate(event.starts_at)
  const userTier = member?.tier || 'explorer'
  const tierIncludes = event.free_for_tiers?.includes(userTier)
  const hero =
    event.hero_image_url ||
    (event.category ? CATEGORY_FALLBACK_IMAGES[event.category] : undefined)

  // Ticket CTA copy depends on auth state + tier + current access.
  // Same decision tree as before; just wrapped for readability.
  let ctaLabel: string
  let ctaDisabled = claimLoading
  let ctaHint: string | null = null
  let ctaVariant: 'default' | 'secondary' = 'default'

  if (event.access === 'ticketed' || claimSuccess) {
    ctaLabel = "You're in"
    ctaDisabled = true
    ctaVariant = 'secondary'
  } else if (event.ticket_price_cents === 0) {
    ctaLabel = claimLoading ? 'Confirming…' : 'RSVP (free)'
  } else if (!isSignedIn) {
    ctaLabel = `Get ticket — ${formatPrice(event.ticket_price_cents)}`
    ctaHint = 'You\u2019ll sign in first, then we\u2019ll pick up where you left off.'
  } else if (tierIncludes) {
    ctaLabel = claimLoading ? 'Claiming…' : 'Claim free ticket'
    ctaHint = `Your ${userTier === 'vip' ? 'VIP' : 'Regular'} membership covers this.`
  } else {
    ctaLabel = claimLoading
      ? 'Opening Checkout…'
      : `Get ticket — ${formatPrice(event.ticket_price_cents)}`
    if (event.free_for_tiers?.length > 0) {
      const upgradeTo = event.free_for_tiers.includes('regular') ? 'Regular' : 'VIP'
      ctaHint = `Or upgrade to ${upgradeTo} and attend free.`
    }
  }

  return (
    <>
      {/* Hero band — category-aware image + title overlay */}
      {hero && (
        <section className="relative h-[50vh] min-h-[400px] w-full overflow-hidden">
          <Image
            src={hero}
            alt=""
            fill
            priority
            className="object-cover"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/50 to-background" />
          <div className="relative z-10 h-full flex items-end pb-12 md:pb-16">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
              <Link
                href={event.category ? `/events?category=${event.category}` : '/events'}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground font-body transition-colors mb-6"
              >
                <ArrowLeft className="w-4 h-4" />
                {categoryLabel(event.category)}
              </Link>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge variant="outline" className="font-body">
                  {categoryLabel(event.category)}
                </Badge>
                {event.is_featured && <Badge className="font-body">Featured</Badge>}
                {event.access === 'ticketed' && (
                  <Badge variant="secondary" className="font-body">
                    You&rsquo;re in
                  </Badge>
                )}
              </div>

              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-[1.1]">
                {event.title}
              </h1>
              {event.subtitle && (
                <p className="font-heading italic text-xl md:text-2xl text-foreground/80 mt-3">
                  {event.subtitle}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="py-12 md:py-16 bg-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Post-Stripe banners */}
          {successParam && (
            <div className="mb-8 rounded-xl border border-primary/40 bg-primary/5 px-6 py-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                    Ticket confirmed
                  </p>
                  <p className="text-sm text-foreground font-body mt-1">
                    Your ticket for {event.title} is on its way. Check your
                    email for the Zoom link.
                  </p>
                </div>
              </div>
            </div>
          )}

          {wasCanceled && !successParam && (
            <div className="mb-8 rounded-xl border border-border bg-card px-6 py-4">
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                Checkout canceled
              </p>
              <p className="text-sm text-foreground font-body mt-1">
                No charge. You can still get a ticket below.
              </p>
            </div>
          )}

          {/* When + where + presenter */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-10">
            <div className="rounded-xl border border-border bg-card p-5">
              <Calendar className="w-4 h-4 text-primary mb-2" />
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                Date
              </p>
              <p className="font-heading text-lg font-bold text-foreground mt-1">
                {when.weekday}
              </p>
              <p className="text-sm text-muted-foreground font-body">
                {when.date}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <Clock className="w-4 h-4 text-primary mb-2" />
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                Time
              </p>
              <p className="font-heading text-lg font-bold text-foreground mt-1">
                {when.time}
              </p>
              <p className="text-sm text-muted-foreground font-body">
                Zoom + venue livestream
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <Users className="w-4 h-4 text-primary mb-2" />
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                With
              </p>
              <p className="font-heading text-lg font-bold text-foreground mt-1">
                {event.presenter_name || 'Host TBA'}
              </p>
              {event.presenter_role && (
                <p className="text-sm text-muted-foreground font-body">
                  {event.presenter_role}
                </p>
              )}
            </div>
          </div>

          {/* Two-column: description + ticket panel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              {event.description ? (
                <div className="prose prose-invert max-w-none">
                  <h2 className="font-heading text-2xl font-bold text-foreground mb-4">
                    About this event
                  </h2>
                  <p className="text-base text-foreground/90 font-body leading-relaxed whitespace-pre-wrap">
                    {event.description}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground font-body italic">
                  Full event details coming soon.
                </p>
              )}
            </div>

            {/* Ticket purchase card — sticky on desktop */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 rounded-xl border border-primary/40 bg-card p-6 space-y-5">
                <div>
                  <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                    Ticket
                  </p>
                  <p className="font-heading text-4xl font-bold text-foreground mt-2">
                    {formatPrice(event.ticket_price_cents)}
                  </p>
                  {event.ticket_price_cents > 0 && (
                    <p className="text-xs text-muted-foreground font-body mt-1">
                      per person
                    </p>
                  )}
                </div>

                {event.capacity && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground font-body">
                    <Users className="w-4 h-4" />
                    <span>Capacity {event.capacity}</span>
                  </div>
                )}

                {error && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-sm text-foreground font-body">{error}</p>
                    </div>
                  </div>
                )}

                <Button
                  variant={ctaVariant}
                  onClick={handleGetTicket}
                  disabled={ctaDisabled}
                  className={cn(
                    'w-full',
                    event.access === 'ticketed' || claimSuccess
                      ? ''
                      : 'font-semibold'
                  )}
                  size="lg"
                >
                  {event.access === 'ticketed' || claimSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      {ctaLabel}
                    </>
                  ) : (
                    ctaLabel
                  )}
                </Button>

                {ctaHint && (
                  <p className="text-sm text-muted-foreground font-body">
                    {ctaHint}
                  </p>
                )}

                {!tierIncludes &&
                  event.free_for_tiers?.length > 0 &&
                  event.access === 'purchase_required' && (
                    <Link
                      href="/membership"
                      className="block text-sm text-primary hover:underline font-body"
                    >
                      See membership options →
                    </Link>
                  )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function EventDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="pt-24 pb-16 bg-background min-h-screen">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="h-96 rounded-xl bg-muted animate-pulse" />
          </div>
        </div>
      }
    >
      <EventDetailInner />
    </Suspense>
  )
}
