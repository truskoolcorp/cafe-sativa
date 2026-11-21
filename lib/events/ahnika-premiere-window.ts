import { stageAudiencePhase, stageAudienceSchedule } from './stage-lobby'

export const AHNIKA_PREMIERE_SLUG = 'ahnika-already-gone'
export const AHNIKA_PREMIERE_START = '2026-12-01T06:00:00.000Z'
export const AHNIKA_PREMIERE_DURATION_MS = 99_700
export const AHNIKA_AUDIENCE_SCHEDULE = stageAudienceSchedule(AHNIKA_PREMIERE_START, AHNIKA_PREMIERE_DURATION_MS)!
export const AHNIKA_PREMIERE_END = AHNIKA_AUDIENCE_SCHEDULE.kickoff + AHNIKA_PREMIERE_DURATION_MS
export const AHNIKA_QA_END = new Date(AHNIKA_AUDIENCE_SCHEDULE.closes).toISOString()

type PremiereRow = {
  starts_at: string
  presenter_name: string | null
  ticket_price_cents: number
  status: string
}

export function isCanonicalAhnikaPremiere(event: PremiereRow) {
  return Date.parse(event.starts_at) === Date.parse(AHNIKA_PREMIERE_START) &&
    event.presenter_name === 'Ahnika Merlot' && event.ticket_price_cents === 0 &&
    ['scheduled', 'live'].includes(event.status)
}

export function ahnikaAudiencePhase(event: PremiereRow, now = Date.now()) {
  return stageAudiencePhase(isCanonicalAhnikaPremiere(event) ? AHNIKA_AUDIENCE_SCHEDULE : null, now)
}

export function ahnikaConciergeWindowOpen(event: PremiereRow, now = Date.now()) {
  return ahnikaAudiencePhase(event, now) === 'hosted'
}

export function ahnikaPlaybackOpen(now = Date.now()) {
  return now >= AHNIKA_AUDIENCE_SCHEDULE.kickoff && now < AHNIKA_PREMIERE_END
}
