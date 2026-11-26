// One private playout buffer, never an early Storage release. The hosted API
// continues to enforce the original cue and cutoff for every media request.
export const DRESS_PLAYOUT_BUFFER_MS = 1250
export const DRESS_PLAYOUT_END_GRACE_MS = 500

export function dressPlayoutEndsAt(cutoff: number) {
  return cutoff + DRESS_PLAYOUT_BUFFER_MS + DRESS_PLAYOUT_END_GRACE_MS
}

export function dressLateJoinPosition(now: number, cue: number, duration: number) {
  const elapsed = (now - cue - DRESS_PLAYOUT_BUFFER_MS) / 1000
  // Preserve the first beat through ordinary network and clock jitter.
  return elapsed < 2 || !Number.isFinite(duration) ? 0 : Math.min(elapsed, Math.max(0, duration - 0.1))
}
