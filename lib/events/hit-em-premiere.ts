// Owner-approved one-off public gathering. This is not a standing event policy.
export const HIT_EM_PREMIERE = Object.freeze({
  eventId: '00e7d9c6-61b9-4af9-827e-b6d13310b762',
  slug: 'hit-em-release-party',
  title: 'Hit Em Release Party',
  startsAt: '2026-11-11T06:00:00.000Z',
  timeZone: 'America/Chicago',
  videoId: 'ZYA0r9JM6eA',
  watchUrl: 'https://www.youtube.com/watch?v=ZYA0r9JM6eA',
  embedUrl: 'https://www.youtube-nocookie.com/embed/ZYA0r9JM6eA?playsinline=1&rel=0',
  path: '/events/hit-em-release-party',
})

export type PublicPremiere = {
  state: 'ready'
  status: 'scheduled' | 'live' | 'ended'
  title: string
  description: string
  startsAt: string
} | { state: 'canceled' }

// Fail closed if the record becomes private, paid, rescheduled, or replaced.
// A public YouTube source must never be described as exclusive paid content.
export function publicHitEmPremiere(value: unknown): PublicPremiere | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.id !== HIT_EM_PREMIERE.eventId || row.slug !== HIT_EM_PREMIERE.slug) return null
  if (row.status === 'canceled') return { state: 'canceled' }
  if (!['scheduled', 'live', 'ended'].includes(String(row.status))) return null
  if (row.ticket_price_cents !== 0 || typeof row.starts_at !== 'string') return null
  if (Date.parse(row.starts_at) !== Date.parse(HIT_EM_PREMIERE.startsAt)) return null
  if (row.title !== HIT_EM_PREMIERE.title) return null
  if (row.description !== null && typeof row.description !== 'string') return null
  if (typeof row.description === 'string' && row.description.length > 10000) return null
  return {
    state: 'ready',
    status: row.status as 'scheduled' | 'live' | 'ended',
    title: HIT_EM_PREMIERE.title,
    description: typeof row.description === 'string' ? row.description : '',
    startsAt: HIT_EM_PREMIERE.startsAt,
  }
}

export function hitEmCalendarEvent() {
  // No duration, host, or end time has been invented.
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cafe Sativa//Public Premiere//EN',
    'BEGIN:VEVENT', `UID:${HIT_EM_PREMIERE.eventId}@cafe-sativa.com`,
    'DTSTAMP:20261108T044354Z', 'DTSTART:20261111T060000Z',
    'SUMMARY:Hit Em Release Party',
    'DESCRIPTION:Free public premiere gathering. YouTube sign-in is required',
    '  to post in live chat.',
    'URL:https://www.cafe-sativa.com/events/hit-em-release-party',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')
}
