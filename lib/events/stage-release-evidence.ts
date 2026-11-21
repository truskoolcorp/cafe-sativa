type Network = 'facebook' | 'instagram'
type Surface = 'lobby' | 'playback' | 'moderation' | 'destination' | 'replay'
type State = 'verified' | 'held' | 'pending' | 'failed' | 'needs_reconciliation'

export type StageReleaseBinding = Readonly<{
  programId: string
  eventUrl: string
  kickoffMs: number
  endMs: number
  promotion?: Readonly<{ metricoolPostId: string; dueMs: number; graceMs: number }>
}>

export type StageSurfaceReceipt = Readonly<{
  kind: Surface
  programId: string
  eventUrl: string
  observedMs: number
  evidenceId: string
}>

export type StageNetworkReceipt = Readonly<{
  brandId: string
  metricoolPostId: string
  network: Network
  status: 'scheduled' | 'published' | 'failed'
  observedMs: number
  providerId?: string
  publicUrl?: string
  publicReadbackMs?: number
}>

const surfaces: readonly Surface[] = ['lobby', 'playback', 'moderation', 'destination', 'replay']
const networks: readonly Network[] = ['facebook', 'instagram']
const hosts = {
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch'],
  instagram: ['instagram.com', 'www.instagram.com'],
}

function publicUrlMatches(network: Network, value?: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      hosts[network].includes(url.hostname) && url.pathname !== '/'
  } catch { return false }
}

function positiveTime(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

/** Read-only and fail-closed. This does not approve, dispatch, retry, or release anything. */
export function reconcileStageRelease(
  binding: StageReleaseBinding,
  evidence: Readonly<{ surfaces: readonly StageSurfaceReceipt[]; networks: readonly StageNetworkReceipt[] }>,
  now: number,
) {
  const checks: Record<Surface | Network, State> = {
    lobby: 'held', playback: 'held', moderation: 'held', destination: 'held', replay: 'held',
    facebook: 'held', instagram: 'held',
  }
  const { kickoffMs, endMs, promotion } = binding
  if (!positiveTime(now) || !positiveTime(kickoffMs) || !positiveTime(endMs) || endMs <= kickoffMs ||
      !binding.programId.trim() || !binding.eventUrl.trim()) return { complete: false, checks }

  for (const kind of surfaces) {
    const found = evidence.surfaces.some(receipt =>
      receipt.kind === kind && receipt.programId === binding.programId && receipt.eventUrl === binding.eventUrl &&
      positiveTime(receipt.observedMs) && receipt.observedMs <= now && receipt.evidenceId.trim() &&
      (kind === 'lobby' ? receipt.observedMs < kickoffMs
        : kind === 'playback' || kind === 'moderation' ? receipt.observedMs >= kickoffMs && receipt.observedMs < endMs
        : kind === 'replay' ? receipt.observedMs >= endMs : true))
    checks[kind] = found ? 'verified'
      : kind === 'lobby' && now >= kickoffMs ? 'needs_reconciliation'
      : (kind === 'playback' || kind === 'moderation') && now >= endMs ? 'needs_reconciliation'
      : kind === 'replay' && now < endMs ? 'pending' : 'held'
  }

  if (promotion?.metricoolPostId.trim() && positiveTime(promotion.dueMs) &&
      Number.isSafeInteger(promotion.graceMs) && promotion.graceMs >= 0) {
    for (const network of networks) {
      const matches = evidence.networks.filter(receipt =>
        receipt.brandId === '7605217' && receipt.metricoolPostId === promotion.metricoolPostId &&
        receipt.network === network && positiveTime(receipt.observedMs) && receipt.observedMs <= now)
        .sort((a, b) => b.observedMs - a.observedMs)
      const latest = matches[0]
      const hasConflict = latest && matches.some(receipt => receipt.observedMs === latest.observedMs &&
        (receipt.status !== latest.status || receipt.providerId !== latest.providerId || receipt.publicUrl !== latest.publicUrl))
      if (hasConflict) checks[network] = 'needs_reconciliation'
      else if (latest?.status === 'published') {
        const readback = latest.publicReadbackMs ?? 0
        checks[network] = latest.observedMs >= promotion.dueMs &&
          latest.providerId?.trim() && publicUrlMatches(network, latest.publicUrl) &&
          positiveTime(readback) && readback >= latest.observedMs && readback <= now
          ? 'verified' : 'needs_reconciliation'
      } else if (latest?.status === 'failed' && latest.observedMs >= promotion.dueMs) checks[network] = 'failed'
      else checks[network] = now - promotion.dueMs <= promotion.graceMs ? 'pending' : 'needs_reconciliation'
    }
  }
  return { complete: Object.values(checks).every(state => state === 'verified'), checks }
}
