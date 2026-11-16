/** Pair order must not depend on database enum ordering or equal-time row order. */
export function chronologicalMessages<T extends { role: string; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const time = Date.parse(a.created_at) - Date.parse(b.created_at)
    if (Number.isFinite(time) && time !== 0) return time
    if (a.role === b.role) return 0
    return a.role === 'user' ? -1 : 1
  })
}
