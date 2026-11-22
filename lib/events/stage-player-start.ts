type Player = { muted: boolean; play: () => Promise<void> }

export function shouldStartScheduledStage(kickoff: number | undefined, serverNow: number | undefined) {
  return kickoff !== undefined && serverNow !== undefined && Number.isFinite(kickoff) &&
    Number.isFinite(serverNow) && serverNow >= kickoff
}

export async function startScheduledStage(player: Player, active: () => boolean, onMutedFallback: () => void) {
  if (!active()) return 'cancelled' as const
  try {
    await player.play()
    return active() ? 'playing' as const : 'cancelled' as const
  } catch (error) {
    if (!active()) return 'cancelled' as const
    if (player.muted || !(error instanceof Error) || error.name !== 'NotAllowedError') return 'needs-tap' as const
    // Starting muted is a per-player browser fallback, not a saved user preference.
    onMutedFallback()
    player.muted = true
    try {
      await player.play()
      return active() ? 'playing-muted' as const : 'cancelled' as const
    } catch {
      return active() ? 'needs-tap' as const : 'cancelled' as const
    }
  }
}
