import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const ALLOWED_TOPICS = new Set([
  'general',
  'press',
  'partnership',
  'artist',
  'chef',
  'performer',
  'venue-tenerife',
  'technical',
])

/**
 * Contact form intake. Writes to `contact_messages` via service-role
 * because the table is locked RLS-tight (we don't want anyone
 * reading other people's contact messages).
 *
 * Validation is deliberately modest:
 *  - email must look like an email
 *  - name + message both required, with generous length caps
 *  - topic must be one of the known values (or fall back to 'general')
 *
 * We don't send a confirmation email from this route — that
 * introduces a Resend dependency that isn't worth it for launch.
 * Instead, the success UI tells the user we've received it and
 * an admin will reply. When we add Resend later, this is the
 * place to hook it in.
 */
export async function POST(req: NextRequest) {
  let body: {
    name?: string
    email?: string
    topic?: string
    subject?: string
    message?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const name = (body.name || '').trim().slice(0, 200)
  const email = (body.email || '').trim().toLowerCase().slice(0, 200)
  const rawTopic = (body.topic || 'general').trim()
  const topic = ALLOWED_TOPICS.has(rawTopic) ? rawTopic : 'general'
  const subject = (body.subject || '').trim().slice(0, 200) || null
  const message = (body.message || '').trim().slice(0, 5000)

  if (!name) {
    return NextResponse.json({ error: 'Please include your name.' }, { status: 400 })
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Please enter a valid email address.' },
      { status: 400 }
    )
  }
  if (!message || message.length < 10) {
    return NextResponse.json(
      { error: 'Please include a message (at least a few words).' },
      { status: 400 }
    )
  }

  try {
    const supabase = createAdminClient()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? ''
    const ipHash = ip
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
          )
        )
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16)
      : null

    const userAgent = req.headers.get('user-agent')?.slice(0, 300) ?? null

    const { error } = await supabase.from('contact_messages').insert({
      name,
      email,
      topic,
      subject,
      message,
      user_agent: userAgent,
      ip_hash: ipHash,
    })

    if (error) {
      console.error('contact_messages insert failed:', error.message)
      return NextResponse.json(
        { error: 'Could not send your message right now. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('contact route error:', err)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
