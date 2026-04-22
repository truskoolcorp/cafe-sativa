import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * POST /api/lounge/post
 *
 * Post a message to a Lounge room. Body:
 *   { room_id: string, content: string }
 *
 * The RLS policy lounge_messages_insert already enforces tier + auth
 * but we do three extra things at the API layer:
 *
 *   1. Rate limit: 10 messages/min/user via the
 *      public.lounge_recent_msg_count() helper. RLS can't do rolling
 *      rate limits cleanly; doing it here keeps the check near the
 *      write.
 *   2. Profile resolution: the client doesn't need to send
 *      author_name / author_tier / is_staff. We read from profiles +
 *      memberships on the server and denormalize into the row, so a
 *      user can't impersonate someone else.
 *   3. Clean error shapes: { code, error } so the client UI can
 *      distinguish 'not_authenticated', 'tier_insufficient',
 *      'rate_limited', 'room_not_found' without parsing prose.
 */

type Body = {
  room_id: string
  content: string
}

const MESSAGES_PER_MINUTE = 10

export async function POST(req: Request) {
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
  if (!authData.user) {
    return NextResponse.json(
      { error: 'Sign in to join the Lounge.', code: 'not_authenticated' },
      { status: 401 }
    )
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const content = (body.content || '').trim()
  if (!content) {
    return NextResponse.json(
      { error: 'Empty messages aren\u2019t posted.', code: 'empty' },
      { status: 400 }
    )
  }
  if (content.length > 2000) {
    return NextResponse.json(
      { error: 'Keep it under 2000 characters.', code: 'too_long' },
      { status: 400 }
    )
  }
  if (!body.room_id) {
    return NextResponse.json(
      { error: 'room_id is required.', code: 'missing_room' },
      { status: 400 }
    )
  }

  // Rate limit check via DB function. Runs as security-definer so RLS
  // doesn't hide rows from the count.
  const { data: recentCount, error: rlErr } = await supabase.rpc(
    'lounge_recent_msg_count',
    {
      p_user_id: authData.user.id,
      p_room_id: body.room_id,
    }
  )

  if (rlErr) {
    console.error('[lounge/post] rate-limit query failed', rlErr)
    // Fail open — if we can't count, let the message through rather
    // than block legitimate users on a DB hiccup.
  } else if ((recentCount as number) >= MESSAGES_PER_MINUTE) {
    return NextResponse.json(
      {
        error:
          'Slow down — you can post up to 10 messages per minute.',
        code: 'rate_limited',
      },
      { status: 429 }
    )
  }

  // Resolve author info server-side so the client can't lie about
  // tier or staff status. RLS lets the user read their own profile
  // + membership.
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, is_staff, is_admin')
    .eq('id', authData.user.id)
    .maybeSingle()

  const { data: membership } = await supabase
    .from('memberships')
    .select('tier, status')
    .eq('user_id', authData.user.id)
    .maybeSingle()

  const authorName =
    profile?.display_name ||
    authData.user.email?.split('@')[0] ||
    'Member'
  const authorTier =
    membership?.status === 'active' ? membership.tier : 'explorer'
  const isStaff = Boolean(profile?.is_staff || profile?.is_admin)

  const { data: inserted, error: insertError } = await supabase
    .from('lounge_messages')
    .insert({
      room_id: body.room_id,
      user_id: authData.user.id,
      author_name: authorName,
      author_tier: authorTier,
      is_staff: isStaff,
      content,
    })
    .select('id, created_at')
    .single()

  if (insertError) {
    // Most likely cause: the RLS lounge_messages_insert policy rejected
    // the row because the user's tier is below min_post_tier. Surface
    // that specifically so the UI can nudge them toward upgrading.
    const msg = insertError.message || ''
    if (msg.includes('policy') || msg.includes('row-level security')) {
      return NextResponse.json(
        {
          error:
            'Regular or VIP members can post in the Lounge. Upgrade your plan to join the conversation.',
          code: 'tier_insufficient',
        },
        { status: 403 }
      )
    }
    console.error('[lounge/post] insert failed', insertError)
    return NextResponse.json(
      { error: insertError.message || 'Could not post.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ id: inserted.id, created_at: inserted.created_at })
}
