import { notFound, redirect } from 'next/navigation'
import { LoungeRoom } from '@/app/lounge/LoungeRoom'
import { loungeDisplayName } from '@/lib/lounge-speaker'
import { createClient } from '@/lib/supabase/server'
import StageLobby from '@/components/events/StageLobby'
import StagePremiereVideo from '@/components/events/StagePremiereVideo'
import StageDressPlayer from '@/components/events/StageDressPlayer'
import StagePremiereRefresh from '@/components/events/StagePremiereRefresh'
import { PRIVATE_STAGE_REHEARSAL_ROOM, privateStagePlaybackSlot, rehearsalInviteCoversCut, rehearsalAccessEnd, soloStageHostTest } from '@/lib/events/private-stage-rehearsal'
import { isCleanRehearsalSlot } from '@/lib/events/ahnika-premiere-media'
import { signCleanRehearsalCut } from '@/lib/events/stage-rehearsal-storage'
import { privateDressMedia } from '@/lib/events/private-dress-media'
import { dressPlayoutEndsAt } from '@/lib/events/stage-dress-playout'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Private Stage rehearsal', robots: { index: false, follow: false } }

export default async function Rehearsal() {
  if (process.env.STAGE_PRIVATE_REHEARSAL_ENABLED !== 'true') notFound()
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user || user.is_anonymous) redirect('/auth/signin?next=%2Fstage%2Frehearsal')
  const { data: invitation } = await db.from('stage_rehearsal_invites').select('user_id,can_draft,expires_at')
    .eq('user_id', user.id).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!invitation) notFound()
  const { data: room } = await db.from('lounge_rooms')
    .select('id').eq('id', PRIVATE_STAGE_REHEARSAL_ROOM).maybeSingle()
  if (!room) notFound()
  const [profile, messages] = await Promise.all([
    db.from('profiles').select('display_name,is_staff,is_admin').eq('id', user.id).maybeSingle(),
    db.from('lounge_messages').select('id,user_id,author_name,author_tier,is_staff,content,created_at')
      .eq('room_id', room.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
  ])
  if (messages.error) notFound()
  const configured = privateStagePlaybackSlot(process.env)
  const slot = configured && rehearsalInviteCoversCut(invitation.expires_at, rehearsalAccessEnd(configured), configured.inviteUntil) ? configured : null
  if (configured?.dress && !slot) notFound()
  const now = Date.now()
  const dressMediaReady = Boolean(slot?.dress && privateDressMedia(process.env.STAGE_PRIVATE_DRESS_MEDIA))
  const dressPlayoutEnd = slot?.dress ? dressPlayoutEndsAt(slot.end) : null
  const hostSlotActive = Boolean(slot && now >= slot.start && now < slot.end)
  const soloHost = Boolean(slot && hostSlotActive && soloStageHostTest(slot, user.id, process.env))
  const dressOpen = Boolean(slot?.dress && dressMediaReady && now >= slot.dress.doors && now < slot.dress.closes)
  const boundary = slot?.dress ? [slot.dress.doors, slot.dress.intro, slot.start, dressPlayoutEnd!, slot.dress.closes].find(at => at > now)
    : slot && (now < slot.start ? slot.start : now < slot.end ? slot.end : null)
  const cleanAvailable = slot && isCleanRehearsalSlot(slot, process.env) && now >= slot.start && now < slot.end
    ? Boolean(await signCleanRehearsalCut()) : false
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 pb-12 pt-28">
      <h1 className="font-heading text-3xl font-bold">Private Stage rehearsal</h1>
      <p>Invite-only Stage rehearsal. This is not the December 1 premiere.</p>
      {slot?.dress && <p>Doors open at 7:45 a.m. Central. The synchronized performance starts at 8:00 a.m. Central. Private chat and troubleshooting stay open until 9:00 a.m. Central.</p>}
      {boundary && <StagePremiereRefresh key={boundary} startsAt={new Date(boundary).toISOString()} serverNow={now} />}
      {slot?.dress && (!dressMediaReady || now < slot.dress.doors) ? (
        <p role="status">{dressMediaReady ? 'The rehearsal room will open at 7:45 a.m. Central.' : 'The dress rehearsal is not ready to open.'}</p>
      ) : slot && (slot.dress && now >= slot.dress.intro && dressPlayoutEnd && now < dressPlayoutEnd ? (
        <StageDressPlayer key="dress-player" introAt={slot.dress.intro} kickoff={slot.start} cutoff={slot.end} serverNow={now} />
      ) : now < slot.start ? (
        <StageLobby startsAt={slot.startsAt} serverNow={now}
          poster="/rooms/stage-beach-terrace-v2.webp"
          loop={{ webm: '/rooms/stage-golden-hour-surf-v3.webm', mp4: '/rooms/stage-golden-hour-surf-v3.mp4' }}
          sound="/rooms/stage-golden-hour-surf-v2.wav"
          intro="Private rehearsal: welcome to The Stage. Please welcome Ahnika Merlot with Already Gone." />
      ) : now < slot.end ? (
        <>
          {slot.onDemand && <p>Rehearsal playback is open. Play, pause, or rewind at your own pace.</p>}
          <StagePremiereVideo key="rehearsal-performance"
            src={cleanAvailable ? '/api/stage/rehearsal-media?cut=clean' : '/api/stage/rehearsal-media'}
            label={cleanAvailable ? 'Private rehearsal: Laviche opening and Ahnika performance' : 'Private rehearsal of the approved Ahnika performance'}
            kickoff={slot.onDemand ? undefined : slot.start} serverNow={now} />
        </>
      ) : (
        <p role="status">{slot.dress ? 'The scheduled performance has ended. You can keep using chat and testing moderation until 9:00 a.m. Central.' : 'The rehearsal playback window has ended. The private chat remains available for invited participants.'}</p>
      ))}
      {(!slot?.dress || dressOpen) && <section className="flex h-[34rem] flex-col rounded-2xl border border-border bg-card p-4" aria-label="Private rehearsal chat">
        <LoungeRoom roomId={room.id} userId={user.id} displayName={loungeDisplayName(profile.data?.display_name, room.id, user.id)}
          tier="explorer" minPostTier="explorer" isStaff={Boolean(profile.data?.is_staff || profile.data?.is_admin)}
          initialMessages={(messages.data || []).reverse()} conciergeDrafts privateRoom
          rehearsalDraftModerator={invitation.can_draft === true && !soloHost} soloStageHostTest={soloHost}
          dressReportsSince={dressOpen && slot?.dress && process.env.STAGE_PRIVATE_DRESS_REPORTS_ENABLED === 'true'
            ? new Date(slot.dress.doors).toISOString() : undefined}
          ahnikaOnStage={Boolean(slot?.dress && dressPlayoutEnd && now >= slot.start && now < dressPlayoutEnd)}
          stageHostInbox={dressOpen || soloHost || (hostSlotActive && process.env.VERCEL_ENV !== 'production' && process.env.STAGE_HOST_INBOX_ENABLED === 'true')} />
      </section>}
    </main>
  )
}
