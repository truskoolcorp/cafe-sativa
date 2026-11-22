import { AHNIKA_AUDIENCE_SCHEDULE, AHNIKA_PREMIERE_DURATION_MS } from './ahnika-premiere-window'

export const PRIVATE_STAGE_REHEARSAL_ROOM = '5cafe000-0000-4000-8000-000000000001'
const productionCushionMs = 15 * 60_000
const productionInviteTailMs = 30 * 60_000
const productionPlaybackWindowMs = 60 * 60_000

export function privateStagePlaybackSlot(env: Record<string, string | undefined>) {
  const production = env.VERCEL_ENV === 'production'
  if ((!production && env.VERCEL_ENV !== 'preview') || env.STAGE_PRIVATE_REHEARSAL_ENABLED !== 'true') return null
  // A copied Preview setting must never activate playback in production.
  const startsAt = production ? env.STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT : env.STAGE_PRIVATE_REHEARSAL_STARTS_AT
  if (!startsAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(startsAt)) return null
  const start = Date.parse(startsAt)
  if (!Number.isFinite(start) || new Date(start).toISOString() !== startsAt.replace('Z', '.000Z')) return null
  const end = start + (production ? productionPlaybackWindowMs : AHNIKA_PREMIERE_DURATION_MS)
  const inviteUntil = production ? end + productionInviteTailMs : undefined
  if (inviteUntil !== undefined && inviteUntil + productionCushionMs > AHNIKA_AUDIENCE_SCHEDULE.doors) return null
  return { startsAt, start, end, inviteUntil, onDemand: production }
}

export function rehearsalInviteCoversCut(expiresAt: string, end: number, inviteUntil?: number) {
  const expiry = Date.parse(expiresAt)
  return Number.isFinite(expiry) && expiry >= end && (inviteUntil === undefined || expiry <= inviteUntil)
}
