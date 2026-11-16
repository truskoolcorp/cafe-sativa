import { NextResponse } from 'next/server'
import { loadHitEmPremiere } from '@/lib/events/load-hit-em-premiere'
import { hitEmCalendarEvent } from '@/lib/events/hit-em-premiere'

export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const event = await loadHitEmPremiere()
    if (!event || event.state !== 'ready' || event.status === 'ended') return new NextResponse('This gathering is not available.', { status: 404, headers })
    return new NextResponse(hitEmCalendarEvent(), { headers: {
      ...headers, 'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="hit-em-release-party.ics"',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch {
    return new NextResponse('The calendar file is temporarily unavailable.', { status: 503, headers })
  }
}
