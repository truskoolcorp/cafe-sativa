import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * POST /api/lounge/delete
 *
 * Soft-delete a message. Body: { message_id: string }
 *
 * Authorization is enforced by two RLS update policies:
 *   - lounge_messages_update_own: user can update their own messages
 *   - lounge_messages_update_staff: staff/admin can update any
 *
 * We don't do a hard DELETE — historical rows stay around with
 * deleted_at + deleted_by set so we can audit abuse patterns later.
 * The read policy filters out deleted_at IS NOT NULL so the UI
 * never shows them.
 */

type Body = { message_id: string }

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
      { error: 'Not signed in.', code: 'not_authenticated' },
      { status: 401 }
    )
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  if (!body.message_id) {
    return NextResponse.json(
      { error: 'message_id required.' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('lounge_messages')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authData.user.id,
    })
    .eq('id', body.message_id)
    // RLS filters: this update only matches rows the user is allowed
    // to touch (own message OR staff). If neither, .select() returns
    // zero rows and we 403.
    .select('id')

  if (error) {
    console.error('[lounge/delete] update failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      {
        error: 'You can only delete your own messages.',
        code: 'forbidden',
      },
      { status: 403 }
    )
  }

  return NextResponse.json({ ok: true })
}
