import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loungeUsernamesEnabled, normalizeLoungeUsername } from '@/lib/lounge-usernames'

export async function POST(request: Request) {
  if (!loungeUsernamesEnabled) return NextResponse.json({ error: 'Chat usernames aren’t enabled yet.' }, { status: 404 })
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user || user.is_anonymous) return NextResponse.json({ error: 'Sign in to choose a chat username.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || (body.username !== null && typeof body.username !== 'string')) {
    return NextResponse.json({ error: 'Enter a username or choose a generated one.' }, { status: 400 })
  }
  const username = body.username === null ? null : normalizeLoungeUsername(body.username)
  if (body.username !== null && !username) {
    return NextResponse.json({ error: 'Use 3–24 characters. Start with a letter and use letters, numbers, hyphens or underscores.' }, { status: 422 })
  }

  const { data, error } = await db.rpc('save_lounge_username', { p_username: username })
  if (error?.code === '23505' && username) {
    return NextResponse.json({ error: 'That username is already taken. Try another.' }, { status: 409 })
  }
  if (error?.code === '23514') {
    return NextResponse.json({ error: 'That username isn’t allowed. Try something without profanity or a reserved name.' }, { status: 422 })
  }
  if (error || typeof data !== 'string') {
    return NextResponse.json({ error: 'Couldn’t save your chat username. Try again shortly.' }, { status: 503 })
  }
  return NextResponse.json({ username: data })
}
