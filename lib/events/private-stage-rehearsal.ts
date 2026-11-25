import { AHNIKA_AUDIENCE_SCHEDULE, AHNIKA_PREMIERE_DURATION_MS } from './ahnika-premiere-window'
import { stageAudienceSchedule } from './stage-lobby'

export const PRIVATE_STAGE_REHEARSAL_ROOM = '5cafe000-0000-4000-8000-000000000001'
const productionCushionMs = 15 * 60_000
const productionInviteTailMs = 30 * 60_000
const productionPlaybackWindowMs = 60 * 60_000
export const DRESS_REHEARSAL_KICKOFF = '2026-11-24T14:00:00Z'
const DRESS_REHEARSAL_WRAP = Date.parse('2026-11-24T15:00:00Z')
const ENCORE_KICKOFF = '2026-11-25T23:00:00Z'
const ENCORE_CLOSE = Date.parse('2026-11-26T00:00:00Z')

// The encore verifies private playout and chat. Leave the prior date-bound report lane closed.
export function privateDressReportSlot(startsAt: string) {
  return startsAt === DRESS_REHEARSAL_KICKOFF
}

export function rehearsalAccessEnd(slot: { end: number; dress?: { closes: number } | null }) {
  return slot.dress?.closes ?? slot.end
}

export function privateStagePlaybackSlot(env: Record<string, string | undefined>) {
  const production = env.VERCEL_ENV === 'production'
  if ((!production && env.VERCEL_ENV !== 'preview') || env.STAGE_PRIVATE_REHEARSAL_ENABLED !== 'true') return null
  const dressKickoff = env.STAGE_PRIVATE_DRESS_KICKOFF
  if (dressKickoff) {
    const encore = env.VERCEL_ENV === 'preview' && dressKickoff === ENCORE_KICKOFF
    if (dressKickoff !== DRESS_REHEARSAL_KICKOFF && !encore) return null
    const closes = encore ? ENCORE_CLOSE : DRESS_REHEARSAL_WRAP
    const audience = stageAudienceSchedule(dressKickoff, AHNIKA_PREMIERE_DURATION_MS)!
    // Keep the room open for troubleshooting without moving either media cue.
    const dress = { ...audience, closes }
    return { startsAt: dressKickoff, start: dress.kickoff, end: dress.kickoff + AHNIKA_PREMIERE_DURATION_MS,
      inviteUntil: closes, onDemand: false, dress }
  }
  // A copied Preview setting must never activate playback in production.
  const startsAt = production ? env.STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT : env.STAGE_PRIVATE_REHEARSAL_STARTS_AT
  if (!startsAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(startsAt)) return null
  const start = Date.parse(startsAt)
  if (!Number.isFinite(start) || new Date(start).toISOString() !== startsAt.replace('Z', '.000Z')) return null
  const end = start + (production ? productionPlaybackWindowMs : AHNIKA_PREMIERE_DURATION_MS)
  const inviteUntil = production ? end + productionInviteTailMs : undefined
  if (inviteUntil !== undefined && inviteUntil + productionCushionMs > AHNIKA_AUDIENCE_SCHEDULE.doors) return null
  return { startsAt, start, end, inviteUntil, onDemand: production, dress: null }
}

export function rehearsalInviteCoversCut(expiresAt: string, end: number, inviteUntil?: number) {
  const expiry = Date.parse(expiresAt)
  return Number.isFinite(expiry) && expiry >= end && (inviteUntil === undefined || expiry <= inviteUntil)
}

/** A transport smoke test for one existing guest, never a moderator grant. */
export function soloStageHostTest(slot: { onDemand: boolean; startsAt: string }, userId: string, env: Record<string, string | undefined>) {
  return env.VERCEL_ENV === 'production' && slot.onDemand && Boolean(userId)
    && slot.startsAt === env.STAGE_PRIVATE_SOLO_HOST_STARTS_AT && userId === env.STAGE_PRIVATE_SOLO_HOST_USER_ID
}
