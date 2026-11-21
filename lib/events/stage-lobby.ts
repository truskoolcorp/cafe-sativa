export const STAGE_INTRO_LEAD_MS = 30_000

export function stageLobbyPhase(startsAt: string, now: number) {
  const start = Date.parse(startsAt)
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 'unavailable'
  const remaining = start - now
  if (remaining <= 0) return 'kickoff'
  return remaining <= STAGE_INTRO_LEAD_MS ? 'intro' : 'lobby'
}
