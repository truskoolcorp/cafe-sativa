import { AHNIKA_PREMIERE_END, ahnikaPlaybackOpen } from './ahnika-premiere-window'

const ORIGIN = 'https://ekaukffotzujkkpdvpgj.supabase.co'
const RELAY = '/functions/v1/cafe-sativa-stage-canary'
const VIDEO = '/storage/v1/object/sign/cafe-sativa-content/Ahnika_Merlot_Cafe_Sativa_Stage_Premiere_Cut.mp4'
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export async function serveAhnikaPremiereMedia(request: Request, deps: {
  relayUrl?: string
  key?: string
  canonical: () => Promise<boolean>
  fetch: typeof fetch
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  const denied = () => new Response(null, { status: 404, headers: NO_STORE })
  const unavailable = () => new Response('Premiere media temporarily unavailable.', { status: 503, headers: NO_STORE })
  if (!ahnikaPlaybackOpen(now())) return denied()
  const range = request.headers.get('range')
  if (range && !/^bytes=(?:[0-9]{1,15}-[0-9]{0,15}|-[0-9]{1,15})$/.test(range)) {
    return new Response(null, { status: 416, headers: NO_STORE })
  }
  if (!deps.relayUrl || !deps.key) return unavailable()
  try {
    const relay = new URL(deps.relayUrl)
    if (relay.origin !== ORIGIN || relay.pathname !== RELAY || relay.username || relay.password) return unavailable()
    if (!await deps.canonical() || !ahnikaPlaybackOpen(now())) return denied()
    // Cancel in-flight origin transfers at show end as well as refusing new requests.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, AHNIKA_PREMIERE_END - now()))])
    relay.searchParams.set('asset', 'video')
    const link = await deps.fetch(relay, {
      headers: { 'x-canary-key': deps.key }, cache: 'no-store', redirect: 'error', signal,
    })
    if (!link.ok) return unavailable()
    const payload = await link.json()
    if (typeof payload?.url !== 'string') return unavailable()
    const upstream = new URL(payload.url)
    if (upstream.origin !== ORIGIN || upstream.pathname !== VIDEO || !upstream.searchParams.get('token')
      || upstream.username || upstream.password) return unavailable()
    if (!ahnikaPlaybackOpen(now())) return denied()
    const video = await deps.fetch(upstream, {
      headers: range ? { Range: range } : {}, cache: 'no-store', redirect: 'error', signal,
    })
    const servedRange = video.headers.get('content-range')
    if (video.status === 416) {
      await video.body?.cancel()
      return new Response(null, { status: 416, headers: {
        ...NO_STORE, ...(servedRange && /^bytes \*\/\d+$/.test(servedRange) ? { 'Content-Range': servedRange } : {}),
      } })
    }
    if (!video.body) return unavailable()
    const expectedStatus = range ? 206 : 200
    if (video.status !== expectedStatus || (range && !/^bytes \d+-\d+\/\d+$/.test(servedRange ?? ''))
      || !ahnikaPlaybackOpen(now())) {
      await video.body.cancel()
      return ahnikaPlaybackOpen(now()) ? unavailable() : denied()
    }
    const headers = new Headers({ ...NO_STORE, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' })
    if (servedRange) headers.set('Content-Range', servedRange)
    const size = video.headers.get('content-length')
    if (size && /^\d+$/.test(size)) headers.set('Content-Length', size)
    // Only public video bytes go back. Never forward the signer URL or upstream headers.
    return new Response(video.body, { status: video.status, headers })
  } catch {
    return ahnikaPlaybackOpen(now()) ? unavailable() : denied()
  }
}
