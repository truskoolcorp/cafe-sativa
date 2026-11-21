import Link from 'next/link'
import { notFound } from 'next/navigation'
import StagePremiereRefresh from '@/components/events/StagePremiereRefresh'
import StageLobby from '@/components/events/StageLobby'
import StagePremiereVideo from '@/components/events/StagePremiereVideo'
import { AHNIKA_AUDIENCE_SCHEDULE, AHNIKA_PREMIERE_SLUG as slug, AHNIKA_PREMIERE_START, ahnikaAudiencePhase, isCanonicalAhnikaPremiere } from '@/lib/events/ahnika-premiere-window'
import { LoungeRoom } from '@/app/lounge/LoungeRoom'
import { loungeMembershipTier } from '@/lib/lounge-membership'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const startsAt = AHNIKA_PREMIERE_START
const audience = AHNIKA_AUDIENCE_SCHEDULE
const localDoors = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
}).format(audience.doors)
const lobbyIntro = 'Good evening, Café Sativa! Let’s give our artist a warm welcome in the chat. Tonight on The Stage: an intimate acoustic performance of “Already Gone.” Please welcome Ahnika Merlot.'
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
  const supabase = createClient()
  const { data: event } = await supabase.from('my_events_v')
    .select('slug, starts_at, ticket_price_cents, status, presenter_name')
    .eq('slug', slug).maybeSingle()
  if (!event || !isCanonicalAhnikaPremiere(event)) notFound()

  const serverNow = Date.now()
  const phase = ahnikaAudiencePhase(event, serverNow)
  const chatOpen = phase === 'mingling' || phase === 'hosted'
  const started = serverNow >= audience.kickoff
  const refreshAt = [audience.doors, audience.intro, audience.kickoff, audience.closes].find(at => at > serverNow)
  const [video, { data: auth }] = await Promise.all([
    started ? premiereVideo() : Promise.resolve(null),
    chatOpen ? supabase.auth.getUser() : Promise.resolve({ data: { user: null } }),
  ])

  const user = auth.user
  const { data: room } = user ? await supabase.from('lounge_rooms')
    .select('id').eq('slug', slug).maybeSingle() : { data: null }
  const [profiles, memberships, messages] = user && room ? await Promise.all([
    supabase.from('profiles').select('display_name, is_staff, is_admin').eq('id', user.id).maybeSingle(),
    supabase.from('memberships').select('tier, status, current_period_end').eq('user_id', user.id).maybeSingle(),
    supabase.from('lounge_messages').select('id, user_id, author_name, author_tier, is_staff, content, created_at')
      .eq('room_id', room.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
  ]) : [{ data: null }, { data: null }, { data: null }]
  const conciergeOpen = process.env.STAGE_CONCIERGE_DRAFTS_ENABLED === 'true' && phase === 'hosted'
  const { data: premiereGrant } = user && room && conciergeOpen
    ? await supabase.from('stage_premiere_reply_moderators').select('user_id')
      .eq('user_id', user.id).eq('room_id', room.id).maybeSingle()
    : { data: null }
  return (
    <main className="mx-auto min-h-screen max-w-screen-2xl space-y-6 px-4 pb-16 pt-28 sm:px-8">
      {refreshAt !== undefined && (
        <StagePremiereRefresh key={refreshAt} startsAt={new Date(refreshAt).toISOString()} serverNow={serverNow} />
      )}
      <Link href="/stage" className="text-primary underline">The Stage</Link>
      <header className="space-y-3">
        <h1 className="font-heading text-4xl font-bold">Ahnika Merlot — Already Gone</h1>
        <p>An intimate prerecorded acoustic performance at Café Sativa.</p>
        <p><time dateTime={startsAt}>December 1, 2026 at 12:00 a.m. Central</time></p>
      </header>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Café Sativa · The Stage</p>
          <span className="rounded-full border border-border px-3 py-1 text-xs" aria-live="polite">
            {!started ? 'Pre-show lobby' : video ? 'Premiere viewing' : 'Playback unavailable'}
          </span>
        </div>
        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
          <div className="min-w-0 p-4 sm:p-5">
      {!started ? (
        <StageLobby startsAt={startsAt} serverNow={serverNow}
          poster="/rooms/stage-beach-terrace-v2.webp"
          loop={{ webm: '/rooms/stage-golden-hour-surf-v3.webm', mp4: '/rooms/stage-golden-hour-surf-v3.mp4' }}
          sound="/rooms/stage-golden-hour-surf-v2.wav"
          intro={lobbyIntro} />
      ) : video ? (
        <StagePremiereVideo src={video} label="Ahnika Merlot performing Already Gone" />
      ) : (
        <section className="rounded-xl border border-border bg-card p-6" aria-live="polite">
          <h2 className="font-heading text-2xl font-semibold">Playback temporarily unavailable</h2>
          <p className="mt-3">Reload the page to try playback again.</p>
          <a href="/events/ahnika-already-gone" className="mt-4 inline-block text-primary underline">Reload premiere page</a>
        </section>
      )}
          </div>
      <section className="min-w-0 space-y-3 border-t border-border p-4 sm:p-5 xl:border-l xl:border-t-0" aria-labelledby="audience-heading">
        <h2 id="audience-heading" className="font-heading text-2xl font-semibold">Live audience room</h2>
        <div role="status" className="space-y-2">
          {phase === 'waiting' ? (
            <>
              <p className="font-semibold">Doors open <time dateTime={new Date(audience.doors).toISOString()}>{localDoors}</time>.</p>
              <p>Doors open 15 minutes before showtime. Come early to mingle in chat before the house introduction.</p>
            </>
          ) : phase === 'mingling' ? (
            <>
              <p className="font-semibold text-primary">Doors are open</p>
              <p>Get comfortable and say hello to the room. The house introduction is next.</p>
            </>
          ) : phase === 'hosted' ? (
            <p>Chat with the audience and moderators throughout the show.{conciergeOpen ? ' Use Ask a host to send a question for moderator review.' : ''}</p>
          ) : (
            <p>The live audience room is closed.</p>
          )}
        </div>
        {chatOpen && <p className="text-sm text-muted-foreground">Keep it respectful. Harassment, threats, explicit content, private contact details, spam, and external links aren’t allowed. Report anything that slips through.</p>}
        {!chatOpen ? null : user && room ? (
          <div className="flex h-[28rem] min-h-0 flex-col">
            <LoungeRoom roomId={room.id} userId={user.id}
              displayName={profiles.data?.display_name || user.email?.split('@')[0] || 'Member'}
              tier={loungeMembershipTier(memberships.data)}
              isStaff={Boolean(profiles.data?.is_staff || profiles.data?.is_admin)}
              minPostTier="explorer" initialMessages={(messages.data || []).reverse()}
              conciergeDrafts={conciergeOpen} premiereDraftModerator={Boolean(premiereGrant)} />
          </div>
        ) : user ? (
          <p role="status">The audience room is temporarily unavailable.</p>
        ) : (
          <Link className="text-primary underline" href="/auth/signin?next=%2Fevents%2Fahnika-already-gone">Sign in to join the live audience room</Link>
        )}
        {phase === 'hosted' && <Link href="/ask" target="_blank" rel="noopener noreferrer" className="inline-block text-primary underline">Open private concierge chat in a new tab</Link>}
      </section>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">This performance includes AI-assisted production under Tru Skool Entertainment International Corp.’s creative direction.</p>
    </main>
  )
}
