export function scheduledPlayback(startsAt: string, durationMs: number, now: number) {
  const start = Date.parse(startsAt)
  if (!Number.isFinite(start) || !Number.isFinite(now) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { phase: 'unavailable' } as const
  }
  if (now < start) return { phase: 'lobby' } as const
  if (now >= start + durationMs) return { phase: 'ended' } as const
  return { phase: 'premiere', position: (now - start) / 1000 } as const
}
