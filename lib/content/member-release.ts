/** Release gate for member-facing discovery surfaces.
 * Authorization to watch/download VIP media must be checked separately
 * by the serving API; discoverability is never an entitlement.
 */
export type LibraryCandidate = {
  status: string
  published_at: string | null
  scheduled_at?: string | null
  approved_at: string | null
  approved_by: string | null
  copy_final: string | null
}
export function publiclyReleased(item: LibraryCandidate, now: Date = new Date()): boolean {
  if (item.status !== 'published' || !item.approved_at || !item.approved_by) return false
  if (!item.copy_final?.trim() || !item.published_at) return false
  const published = Date.parse(item.published_at)
  const scheduled = item.scheduled_at ? Date.parse(item.scheduled_at) : published
  return Number.isFinite(published) && Number.isFinite(scheduled)
    && published <= now.getTime() && scheduled <= now.getTime()
}
