export const AHNIKA_PREMIERE_START = '2026-12-01T06:00:00.000Z'
export const AHNIKA_PREMIERE_DURATION_MS = 99_700
export const AHNIKA_QA_END = new Date(Date.parse(AHNIKA_PREMIERE_START) + AHNIKA_PREMIERE_DURATION_MS + 15 * 60_000).toISOString()

export function ahnikaConciergeWindowOpen(event: {
  starts_at: string
  presenter_name: string | null
  ticket_price_cents: number
  status: string
}, now = Date.now()) {
  return Date.parse(event.starts_at) === Date.parse(AHNIKA_PREMIERE_START) &&
    event.presenter_name === 'Ahnika Merlot' && event.ticket_price_cents === 0 &&
    ['scheduled', 'live'].includes(event.status) &&
    now >= Date.parse(AHNIKA_PREMIERE_START) && now < Date.parse(AHNIKA_QA_END)
}
