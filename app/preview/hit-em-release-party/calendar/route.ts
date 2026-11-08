import { canPreviewHitEm } from '@/lib/events/hit-em-preview'
import { hitEmCalendarEvent } from '@/lib/events/hit-em-premiere'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function GET() {
  if (!canPreviewHitEm(process.env)) return new Response('Not found', { status: 404 })
  return new Response(hitEmCalendarEvent(), { headers: {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="hit-em-release-party-preview.ics"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  } })
}
