import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageCircle, Lock, ArrowRight } from 'lucide-react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Button } from '@/components/ui/button'
import { LoungeRoom } from './LoungeRoom'

/**
 * /lounge — the member chat room.
 *
 * Server component does the tier resolution up front so we render
 * the right surface in the initial HTML (no flash of "loading" or
 * "locked"). Three paths:
 *
 *   1. Anonymous           → locked-out card with "sign up" CTA
 *   2. Explorer            → read-only chat (message list + upgrade prompt)
 *   3. Regular / VIP       → full chat via <LoungeRoom> client component
 *
 * Realtime + composer live in the client component (<LoungeRoom>),
 * which takes over once we've determined the user is authenticated.
 * We hand it the initial message snapshot + user meta so the client
 * can skip the first round-trip.
 */

export const metadata: Metadata = {
  title: 'The Lounge — Café Sativa',
  description:
    'Members chat. Channels for each room, live during events, running quietly in the background the rest of the week.',
}

export const dynamic = 'force-dynamic'

type LoungeRoomRow = {
  id: string
  slug: string
  name: string
  description: string | null
  min_post_tier: 'explorer' | 'regular' | 'vip'
}

type InitialMessage = {
  id: string
  user_id: string
  author_name: string
  author_tier: string
  is_staff: boolean
  content: string
  created_at: string
}

async function loadLoungeData() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )

  const { data: authData } = await supabase.auth.getUser()
  const user = authData.user

  // Grab the default Lounge room (slug = 'lounge')
  const { data: room } = await supabase
    .from('lounge_rooms')
    .select('id, slug, name, description, min_post_tier')
    .eq('slug', 'lounge')
    .maybeSingle()

  if (!user || !room) {
    return { user: null, room: room as LoungeRoomRow | null, messages: [], tier: 'anonymous' as const, isStaff: false, displayName: null }
  }

  // Determine tier + staff
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from('memberships')
      .select('tier, status')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('display_name, is_staff, is_admin')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  const tier =
    membership?.status === 'active' && membership.tier
      ? (membership.tier as 'regular' | 'vip')
      : 'explorer'

  const isStaff = Boolean(profile?.is_staff || profile?.is_admin)

  // Initial message snapshot — RLS filters based on tier, so if the
  // room has min_read_tier='vip' and this is a regular member we'd
  // get an empty set here. The default 'lounge' room is explorer-
  // readable so everyone signed in sees messages.
  const { data: messages } = await supabase
    .from('lounge_messages')
    .select(
      'id, user_id, author_name, author_tier, is_staff, content, created_at'
    )
    .eq('room_id', room.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Reverse so the oldest is first (chat reads top → bottom)
  const initialMessages = ((messages as InitialMessage[]) || []).reverse()

  return {
    user: { id: user.id, email: user.email ?? null },
    room: room as LoungeRoomRow,
    messages: initialMessages,
    tier,
    isStaff,
    displayName:
      profile?.display_name || user.email?.split('@')[0] || 'Member',
  }
}

export default async function LoungePage() {
  const data = await loadLoungeData()

  // Anonymous: sign-up gate
  if (!data.user || data.tier === 'anonymous' || !data.room) {
    return <SignedOutState />
  }

  return (
    <div className="pt-20 pb-6 bg-background min-h-screen flex flex-col">
      <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col">
        {/* Header band */}
        <div className="py-4 border-b border-border">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 mb-2">
                <MessageCircle className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] tracking-widest uppercase text-primary font-body font-semibold">
                  The Lounge
                </span>
              </div>
              <h1 className="font-heading text-2xl md:text-3xl font-bold text-foreground leading-tight">
                {data.room.name}
              </h1>
              {data.room.description && (
                <p className="text-sm text-muted-foreground font-body mt-1">
                  {data.room.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Chat surface — client component handles realtime */}
        <LoungeRoom
          roomId={data.room.id}
          userId={data.user.id}
          displayName={data.displayName!}
          tier={data.tier as 'explorer' | 'regular' | 'vip'}
          isStaff={data.isStaff}
          minPostTier={data.room.min_post_tier}
          initialMessages={data.messages}
        />
      </div>
    </div>
  )
}

// ============================================================
// Anonymous state — locked-out card
// ============================================================
function SignedOutState() {
  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-border bg-card p-8 md:p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center mx-auto mb-5">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight mb-3">
            The Lounge is members-only.
          </h1>
          <p className="text-base text-muted-foreground font-body mb-8 leading-relaxed max-w-lg mx-auto">
            A persistent chat room for Café Sativa members — live during
            events, running quietly in the background the rest of the week.
            Sign up free to peek in, or upgrade to post.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" asChild>
              <Link href="/auth/signup">
                Sign up free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/auth/signin?redirect=/lounge">I already have an account</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
