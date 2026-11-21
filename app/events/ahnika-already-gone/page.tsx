import Link from 'next/link'
import { notFound } from 'next/navigation'
import StagePremiereRefresh from '@/components/events/StagePremiereRefresh'
import ScheduledPremierePlayer from '@/components/events/ScheduledPremierePlayer'
import { scheduledPlayback } from '@/lib/events/scheduled-playback'
import { LoungeRoom } from '@/app/lounge/LoungeRoom'
import { loungeMembershipTier } from '@/lib/lounge-membership'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const slug = 'ahnika-already-gone'
const publicStartsAt = '2026-12-01T06:00:00.000Z'
const storageOrigin = 'https://ekaukffotzujkkpdvpgj.supabase.co'

const isolatedRehearsal = () => process.env.VERCEL_ENV === 'preview'
  && process.env.VERCEL_GIT_COMMIT_REF === 'feat/ahnika-stage-canary-20261120'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://anrprovgdpwqcalkolsz.supabase.co'

async function premiereVideo(rehearsal: boolean): Promise<string | null> {
  const relayUrl = rehearsal ? process.env.AHNIKA_STAGE_RELAY_URL : process.env.STAGE_RELEASE_MEDIA_RELAY_URL
  const key = rehearsal ? process.env.AHNIKA_STAGE_RELAY_KEY : process.env.STAGE_RELEASE_MEDIA_RELAY_KEY
  if (!relayUrl || !key) return null
  try {
    const relay = new URL(relayUrl)
    if (relay.origin !== storageOrigin || relay.pathname !== '/functions/v1/cafe-sativa-stage-canary') return null
    relay.searchParams.set('asset', 'video')
    const response = await fetch(relay, {
      headers: { 'x-canary-key': key },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(3500),
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
  const rehearsal = isolatedRehearsal()
  const supabase = createClient()
  const { data: event } = await supabase.from('my_events_v')
    .select('slug, title, starts_at, ticket_price_cents, status, presenter_name')
    .eq('slug', slug).maybeSingle()
  if (!event || event.presenter_name !== 'Ahnika Merlot' || event.ticket_price_cents !== 0 ||
      !['scheduled', 'live'].includes(event.status)) notFound()

  const startsAt = rehearsal ? event.starts_at : publicStartsAt
  if (!Number.isFinite(Date.parse(startsAt)) ||
      (rehearsal ? event.title !== 'Ahnika Merlot — Already Gone (isolated rehearsal)'
        : Date.parse(event.starts_at) !== Date.parse(publicStartsAt))) notFound()
  const durationMs = 99_700
  const admission = scheduledPlayback(startsAt, durationMs, Date.now())
  const signedVideo = admission.phase === 'premiere' ? await premiereVideo(rehearsal) : null

  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  const { data: room } = user ? await supabase.from('lounge_rooms')
    .select('id').eq('slug', slug).maybeSingle() : { data: null }
  const [profiles, memberships, messages] = user && room ? await Promise.all([
    supabase.from('profiles').select('display_name, is_staff, is_admin').eq('id', user.id).maybeSingle(),
    supabase.from('memberships').select('tier, status, current_period_end').eq('user_id', user.id).maybeSingle(),
    supabase.from('lounge_messages').select('id, user_id, author_name, author_tier, is_staff, content, created_at')
      .eq('room_id', room.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
  ]) : [{ data: null }, { data: null }, { data: null }]
  const serverNow = Date.now()
  const phase = scheduledPlayback(startsAt, durationMs, serverNow).phase
  const started = phase !== 'lobby'
  const ended = phase === 'ended'
  const video = phase === 'premiere' ? signedVideo : null

  return (
    <main className="mx-auto min-h-screen max-w-screen-2xl space-y-6 px-4 pb-16 pt-28 sm:px-8">
      <Link href="/stage" className="text-primary underline">The Stage</Link>
      <header className="space-y-3">
        <h1 className="font-heading text-4xl font-bold">Ahnika Merlot — Already Gone</h1>
        <p>An intimate prerecorded acoustic performance at Café Sativa.</p>
        <p><time dateTime={startsAt}>{rehearsal ? 'Private rehearsal kickoff · ' + new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'long',
        }).format(new Date(startsAt)) : 'December 1, 2026 at 12:00 a.m. Central'}</time></p>
      </header>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Café Sativa · The Stage</p>
          <span className="rounded-full border border-border px-3 py-1 text-xs" aria-live="polite">
            {ended ? 'Ended' : !started ? 'Pre-show lobby' : video ? 'Premiere in progress' : 'Playback unavailable'}
          </span>
        </div>
        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
          <div className="min-w-0 p-4 sm:p-5">
      {!ended && admission.phase === 'lobby' && <StagePremiereRefresh startsAt={startsAt} />}
      {ended ? (
        <p>This premiere has ended. <Link href="/vip/recordings" className="text-primary underline">Visit the VIP replay archive</Link>.</p>
      ) : video ? (
        <ScheduledPremierePlayer src={video} startsAt={startsAt} durationMs={durationMs} serverNow={serverNow} />
      ) : (
        <section className="rounded-xl border border-border bg-card p-6" aria-live="polite">
          <h2 className="font-heading text-2xl font-semibold">{started ? 'Playback temporarily unavailable' : 'Premiere lobby'}</h2>
          <p className="mt-3">{started ? 'Reload the page to try playback again.' : rehearsal ? 'The player opens at the private rehearsal kickoff. You can stay on this page.' : 'The player opens at midnight Central. You can stay on this page.'}</p>
          <a href="/events/ahnika-already-gone" className="mt-4 inline-block text-primary underline">Reload premiere page</a>
        </section>
      )}
          </div>
      <section className="min-w-0 space-y-3 border-t border-border p-4 sm:p-5 xl:border-l xl:border-t-0" aria-labelledby="audience-heading">
        <h2 id="audience-heading" className="font-heading text-xl font-semibold">Live audience room</h2>
        <p className="text-sm text-muted-foreground">Chat with the room, ask the host a question, or join a trivia round.</p>
        {user && room ? (
          <div className="flex h-[28rem] min-h-0 flex-col">
            <LoungeRoom roomId={room.id} userId={user.id}
              displayName={profiles.data?.display_name || user.email?.split('@')[0] || 'Member'}
              tier={loungeMembershipTier(memberships.data)}
              isStaff={Boolean(profiles.data?.is_staff || profiles.data?.is_admin)}
              minPostTier="explorer" initialMessages={(messages.data || []).reverse()} />
          </div>
        ) : user ? (
          <p role="status">The audience room is temporarily unavailable.</p>
        ) : (
          <Link className="text-primary underline" href="/auth/signin?next=%2Fevents%2Fahnika-already-gone">Sign in to join the live audience room</Link>
        )}
        {rehearsal ? (
          <p className="text-sm text-muted-foreground">For rehearsal Q&amp;A, post your question in this room for the moderator. Automated concierge replies are not enabled in this preview.</p>
        ) : (
          <Link href="/ask" target="_blank" rel="noopener noreferrer" className="inline-block text-primary underline">Open the separate Café Sativa concierge chat</Link>
        )}
      </section>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">This performance includes AI-assisted production under Tru Skool Entertainment International Corp.’s creative direction.</p>
    </main>
  )
}
