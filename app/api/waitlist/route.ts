import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/**
 * Accepts email signups from the home page "Never Miss a Session"
 * capture. Writes to `marketing_emails` via the service-role client
 * because the table is RLS-locked to service_role only.
 *
 * Intentionally tolerant: we return 200 even on duplicates and
 * validation-lite input (e.g. empty interest field). The only thing
 * that will fail a signup is a missing or malformed email — which
 * we bounce back as 400 so the client can show an inline error.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; name?: string; interest?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const email = (body.email || '').trim().toLowerCase()
  const interest = (body.interest || '').trim() || null

  // Minimum viable email validation — not RFC-perfect, just keeps
  // out the obvious junk.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Please enter a valid email address.' },
      { status: 400 }
    )
  }

  try {
    const supabase = createAdminClient()

    // Hash the IP rather than storing it plaintext. We lose the
    // ability to geo-lookup later, but we also don't hold a PII
    // trail tied to marketing opt-ins. Good default.
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

    // Upsert by (email, source) so re-submissions are a no-op.
    const { error } = await supabase
      .from('marketing_emails')
      .upsert(
        {
          email,
          source: 'home-never-miss',
          interest,
          user_agent: userAgent,
          ip_hash: ipHash,
        },
        { onConflict: 'email,source', ignoreDuplicates: true }
      )

    if (error) {
      console.error('marketing_emails upsert failed:', error.message)
      return NextResponse.json(
        { error: 'Could not save your email right now. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('waitlist route error:', err)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
