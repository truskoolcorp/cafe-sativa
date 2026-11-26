import { rehearsalAccessEnd, rehearsalInviteCoversCut, type privateStagePlaybackSlot } from './private-stage-rehearsal'

const assetSpecs = {
  intro: { suffix: 'mp4', mime: 'video/mp4', max: 20 * 1024 * 1024 },
  captions: { suffix: 'en.vtt', mime: 'text/vtt; charset=utf-8', max: 64 * 1024 },
  reveal: { suffix: 'webp', mime: 'image/webp', max: 2 * 1024 * 1024 },
  performance: { suffix: 'mp4', mime: 'video/mp4', max: 40_000_000 },
} as const
const names = Object.keys(assetSpecs) as (keyof typeof assetSpecs)[]
const bucket = 'cafe-sativa-dress-rehearsal'
const origin = 'https://nwfxvhqbjtfvoopcadff.supabase.co'
const prefix = 'stage-rehearsal/2026-11-24'
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export type DressAssetName = keyof typeof assetSpecs
type Asset = { object: string; bytes: number }
type Slot = NonNullable<ReturnType<typeof privateStagePlaybackSlot>>

export function isDressAssetName(name: string): name is DressAssetName {
  return Object.hasOwn(assetSpecs, name)
}

/** An exact, operator-approved package, never a URL or fallback to the old rehearsal cut. */
export function privateDressMedia(value: string | undefined): Record<DressAssetName, Asset> | null {
  if (!value || value.length > 1024) return null
  try {
    const input = JSON.parse(value)
    if (!input || typeof input !== 'object' || Object.keys(input).length !== names.length) return null
    const seen = new Set<string>()
    const ready = {} as Record<DressAssetName, Asset>
    for (const name of names) {
      if (!Object.hasOwn(input, name)) return null
      const asset = input[name]
      if (!asset || typeof asset !== 'object' || Object.keys(asset).length !== 2 ||
          typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
          seen.has(asset.sha256) || !Number.isSafeInteger(asset.bytes) ||
          asset.bytes <= 0 || asset.bytes > assetSpecs[name].max) return null
      seen.add(asset.sha256)
      ready[name] = { object: `${prefix}/${asset.sha256}.${assetSpecs[name].suffix}`, bytes: asset.bytes }
    }
    return ready
  } catch {
    return null
  }
}

export function privateDressAssetWindow(slot: Slot, name: DressAssetName, now: number) {
  if (!slot.dress || !Number.isFinite(now)) return false
  if (name === 'performance' || name === 'reveal') return now >= slot.start && now < slot.end
  return now >= slot.dress.intro && now < slot.start
}

function byteRange(value: string, bytes: number) {
  const match = /^bytes=(\d{1,15})?-(\d{1,15})?$/.exec(value)
  if (!match || !match[1] && !match[2]) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(bytes - 1, Number(match[2])) : bytes - 1
  return start <= end ? { start, end } : null
}

type Transport = {
  invitation: () => Promise<string | null>
  sign: (bucket: string, object: string) => Promise<string | null>
  fetch: typeof fetch
  now?: () => number
}

export async function servePrivateDressAsset(
  request: Request, slot: Slot, name: DressAssetName, asset: Asset, transport: Transport,
) {
  const now = transport.now ?? Date.now
  const open = () => privateDressAssetWindow(slot, name, now())
  const denied = () => new Response(null, { status: 404, headers })
  const unavailable = () => new Response(null, { status: 503, headers })
  if (!open()) return denied()
  try {
    const expires = await transport.invitation()
    if (!expires || !rehearsalInviteCoversCut(expires, rehearsalAccessEnd(slot), slot.inviteUntil) || !open()) return denied()
    const requested = request.headers.get('range')
    const range = requested === null ? null : byteRange(requested, asset.bytes)
    if (requested !== null && !range) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${asset.bytes}` } })
    }
    const signed = await transport.sign(bucket, asset.object)
    if (!open()) return denied()
    if (!signed) return unavailable()
    const url = new URL(signed)
    if (url.origin !== origin || url.username || url.password ||
        url.pathname !== `/storage/v1/object/sign/${bucket}/${asset.object}` ||
        !url.searchParams.get('token')) return unavailable()
    const end = name === 'intro' || name === 'captions' ? slot.start : slot.end
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, end - now()))])
    const response = await transport.fetch(url, {
      headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) },
      cache: 'no-store', redirect: 'error', signal,
    })
    const length = range ? range.end - range.start + 1 : asset.bytes
    const expectedRange = range ? `bytes ${range.start}-${range.end}/${asset.bytes}` : null
    const encoding = response.headers.get('content-encoding')
    if (!response.body || response.status !== (range ? 206 : 200) ||
        response.headers.get('content-length') !== String(length) ||
        response.headers.get('content-range') !== expectedRange ||
        (encoding !== null && encoding !== 'identity') || !open()) {
      await response.body?.cancel()
      return open() ? unavailable() : denied()
    }
    const output = new Headers({ ...headers, 'Content-Type': assetSpecs[name].mime,
      'Content-Length': String(length), 'Accept-Ranges': 'bytes' })
    if (expectedRange) output.set('Content-Range', expectedRange)
    return new Response(response.body, { status: response.status, headers: output })
  } catch {
    return open() ? unavailable() : denied()
  }
}
