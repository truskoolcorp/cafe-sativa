import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Only this owner-approved walkthrough may be published through this endpoint.
// The bucket remains private; no caller-supplied paths or generic signing API.
const WALKTHROUGH_PATH = 'walkthrough/2026-11-18/137523959ea04db1b95bd73a9b8ee12a0dd67fdff6474f78d0bfa34966c6f522.mp4'

export async function GET() {
  try {
    const { data, error } = await createAdminClient().storage
      .from('cafe-sativa-content')
      .createSignedUrl(WALKTHROUGH_PATH, 3600)
    if (error || !data?.signedUrl) throw new Error('Walkthrough unavailable')
    return NextResponse.redirect(data.signedUrl, {
      status: 307,
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch {
    return new NextResponse('The walkthrough is temporarily unavailable. Please try again shortly.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    })
  }
}
