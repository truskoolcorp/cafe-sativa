// Milliseconds until the cue on the broadcast clock, not the viewer's device clock.
// A negative client elapsed time is invalid. The cue remains available afterward.
export function stageLinkCueDelay(showAt: number, serverNow: number, elapsed: number) {
  if (![showAt, serverNow, elapsed].every(Number.isFinite) || elapsed < 0) return null
  const remaining = showAt - serverNow - elapsed
  return Number.isFinite(remaining) ? Math.max(0, remaining) : null
}
