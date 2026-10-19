/** Server-side membership gate for future VIP-only playback endpoints.
 * IMPORTANT: this does not authorize access to any actual media URL.
 * Future streaming routes must independently check this decision AND canonical
 * asset provenance, content approval, release and rights on every request.
 */
export type ReplayMember = {
 tier?: string | null
 status?: string | null
 current_period_end?: string | null
}
export function vipReplayAllowed(member: ReplayMember | null, now = new Date()): boolean {
 if (!member || member.tier !== 'vip' || member.status !== 'active') return false
 if (member.current_period_end) {
  const end = Date.parse(member.current_period_end)
  if (!Number.isFinite(end) || end <= now.getTime()) return false
 }
 return true
}
