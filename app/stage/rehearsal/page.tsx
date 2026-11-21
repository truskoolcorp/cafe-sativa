import { notFound } from 'next/navigation'
import { LoungeRoom } from '@/app/lounge/LoungeRoom'
import { createClient } from '@/lib/supabase/server'
import { PRIVATE_STAGE_REHEARSAL_ROOM } from '@/lib/events/private-stage-rehearsal'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Private Stage rehearsal', robots: { index: false, follow: false } }

export default async function Rehearsal() {
  if (process.env.STAGE_PRIVATE_REHEARSAL_ENABLED !== 'true') notFound()
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user || user.is_anonymous) notFound()
  const { data: invitation } = await db.from('stage_rehearsal_invites').select('user_id')
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
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 pb-12 pt-28">
      <h1 className="font-heading text-3xl font-bold">Private Stage rehearsal</h1>
      <p>Invite-only concierge and moderation rehearsal. This is not the December 1 premiere.</p>
      <section className="flex h-[34rem] flex-col rounded-2xl border border-border bg-card p-4" aria-label="Private rehearsal chat">
        <LoungeRoom roomId={room.id} userId={user.id} displayName={profile.data?.display_name || 'Rehearsal guest'}
          tier="explorer" minPostTier="explorer" isStaff={Boolean(profile.data?.is_staff || profile.data?.is_admin)}
          initialMessages={(messages.data || []).reverse()} conciergeDrafts privateRoom />
      </section>
    </main>
  )
}
