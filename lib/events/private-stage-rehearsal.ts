import { AHNIKA_PREMIERE_DURATION_MS } from './ahnika-premiere-window'

export const PRIVATE_STAGE_REHEARSAL_ROOM = '5cafe000-0000-4000-8000-000000000001'

export function privateStagePlaybackSlot(env: Record<string, string | undefined>) {
  if (env.VERCEL_ENV !== 'preview' || env.STAGE_PRIVATE_REHEARSAL_ENABLED !== 'true') return null
  const startsAt = env.STAGE_PRIVATE_REHEARSAL_STARTS_AT
  if (!startsAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(startsAt)) return null
  const start = Date.parse(startsAt)
  if (!Number.isFinite(start) || new Date(start).toISOString() !== startsAt.replace('Z', '.000Z')) return null
  return { startsAt, start, end: start + AHNIKA_PREMIERE_DURATION_MS }
}

export function rehearsalInviteCoversCut(expiresAt: string, end: number) {
  return Date.parse(expiresAt) >= end
}
