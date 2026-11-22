import { AHNIKA_AUDIENCE_SCHEDULE, ahnikaPlaybackOpen } from './ahnika-premiere-window'

export const STAGE_HOST_ON_STAGE = 'Ahnika is on The Stage right now. Ask Laviche, or come back after the set.'

// The voice worker rechecks the bridge every 30 seconds with an 8-second timeout.
// Close the real-time session early enough to avoid an answer crossing kickoff.
export const VOICE_PERFORMANCE_BUFFER_MS = 40_000

export function stageHostIsPerforming(host: string, now = Date.now(), leadMs = 0) {
  const { kickoff } = AHNIKA_AUDIENCE_SCHEDULE
  return host === 'ahnika' && (ahnikaPlaybackOpen(now) || (now >= kickoff - leadMs && now < kickoff))
}
