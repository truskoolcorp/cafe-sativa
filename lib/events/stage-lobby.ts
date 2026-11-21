export const STAGE_INTRO_LEAD_MS = 30_000
export const STAGE_DOORS_LEAD_MS = 15 * 60_000
export const STAGE_AFTER_SHOW_MS = 15 * 60_000

export function stageAudienceSchedule(startsAt: string, durationMs: number) {
  const kickoff = Date.parse(startsAt)
  if (!Number.isFinite(kickoff) || !Number.isFinite(durationMs) || durationMs <= 0) return null
  const intro = kickoff - STAGE_INTRO_LEAD_MS
  // Anchor guest-facing doors to the advertised showtime, not the internal cue.
  return { doors: kickoff - STAGE_DOORS_LEAD_MS, intro, kickoff, closes: kickoff + durationMs + STAGE_AFTER_SHOW_MS }
}

export function stageAudiencePhase(schedule: ReturnType<typeof stageAudienceSchedule>, now: number) {
  if (!schedule || !Number.isFinite(now)) return 'closed'
  if (now < schedule.doors) return 'waiting'
  if (now < schedule.intro) return 'mingling'
  if (now < schedule.closes) return 'hosted'
  return 'closed'
}

export function stageLobbyPhase(startsAt: string, now: number) {
  const start = Date.parse(startsAt)
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 'unavailable'
  const remaining = start - now
  if (remaining <= 0) return 'kickoff'
  return remaining <= STAGE_INTRO_LEAD_MS ? 'intro' : 'lobby'
}
