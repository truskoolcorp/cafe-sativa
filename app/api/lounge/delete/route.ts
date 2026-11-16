import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * POST /api/lounge/delete
 *
 * Soft-delete a message. Body: { message_id: string }
 *
 * Ownership/staff authorization is checked by the database RPC.
 * The RPC bypasses the deleted-row read filter only after authorization,
 * retains the row for audit, and derives deleted_by from auth.uid().
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
  if (!body || typeof body.message_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.message_id)) {
    return NextResponse.json(
      { error: 'message_id required.' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase.rpc('soft_delete_lounge_message', {
    p_message_id: body.message_id,
  })

  if (error) {
    if (error.code === '42501') return NextResponse.json({ error: 'You can only delete your own messages, unless you are staff.', code: 'forbidden' }, { status: 403 })
    console.error('[lounge/delete] update failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
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
