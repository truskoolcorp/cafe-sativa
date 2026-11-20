import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const slug = 'ahnika-already-gone'
const startsAt = '2026-12-01T06:00:00.000Z'
const storageOrigin = 'https://ekaukffotzujkkpdvpgj.supabase.co'

async function premiereVideo(): Promise<string | null> {
  const relayUrl = process.env.STAGE_RELEASE_MEDIA_RELAY_URL
  const key = process.env.STAGE_RELEASE_MEDIA_RELAY_KEY
  if (!relayUrl || !key) return null
  try {
    const relay = new URL(relayUrl)
    if (relay.origin !== storageOrigin || relay.pathname !== '/functions/v1/cafe-sativa-stage-canary') return null
    relay.searchParams.set('asset', 'video')
    const response = await fetch(relay, {
      headers: { 'x-canary-key': key },
      cache: 'no-store',
      redirect: 'error',
    })
    if (!response.ok) return null
    const payload = await response.json()
    if (typeof payload.url !== 'string') return null
    const video = new URL(payload.url)
    if (video.origin !== storageOrigin ||
        video.pathname !== '/storage/v1/object/sign/cafe-sativa-content/Ahnika_Merlot_Cafe_Sativa_Stage_Premiere_Cut.mp4' ||
        !video.searchParams.has('token')) return null
    return video.href
  } catch {
    return null
  }
}

export const metadata = { title: 'Ahnika Merlot — Already Gone' }

export default async function AhnikaPremierePage() {
  const { data: event } = await createClient().from('my_events_v')
    .select('slug, starts_at, ticket_price_cents, status, presenter_name')
    .eq('slug', slug).maybeSingle()
  if (!event || event.presenter_name !== 'Ahnika Merlot' || event.ticket_price_cents !== 0 ||
      Date.parse(event.starts_at) !== Date.parse(startsAt) ||
      !['scheduled', 'live'].includes(event.status)) notFound()

  const started = Date.now() >= Date.parse(startsAt)
  const video = started ? await premiereVideo() : null

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 px-4 pb-16 pt-28">
      <Link href="/stage" className="text-primary underline">The Stage</Link>
      <header className="space-y-3">
        <h1 className="font-heading text-4xl font-bold">Ahnika Merlot — Already Gone</h1>
        <p>An intimate prerecorded acoustic performance at Café Sativa.</p>
        <p><time dateTime={startsAt}>December 1, 2026 at 12:00 a.m. Central</time></p>
      </header>
      {video ? (
        <video className="aspect-video w-full rounded-xl bg-black" controls playsInline preload="metadata"
          src={video} aria-label="Ahnika Merlot performing Already Gone" />
      ) : (
        <section className="rounded-xl border border-border bg-card p-6" aria-live="polite">
          <h2 className="font-heading text-2xl font-semibold">{started ? 'Playback temporarily unavailable' : 'Premiere lobby'}</h2>
          <p className="mt-3">{started ? 'Reload the page to try playback again.' : 'Reload this page at midnight Central to watch.'}</p>
          <a href="/events/ahnika-already-gone" className="mt-4 inline-block text-primary underline">Reload premiere page</a>
        </section>
      )}
      <p className="text-sm text-muted-foreground">This performance includes AI-assisted production under Tru Skool Entertainment International Corp.’s creative direction.</p>
    </main>
  )
}
