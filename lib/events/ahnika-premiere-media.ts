import { AHNIKA_PREMIERE_END, ahnikaPlaybackOpen } from './ahnika-premiere-window'

const ORIGIN = 'https://ekaukffotzujkkpdvpgj.supabase.co'
const RELAY = '/functions/v1/cafe-sativa-stage-canary'
const VIDEO = '/storage/v1/object/sign/cafe-sativa-content/Ahnika_Merlot_Cafe_Sativa_Stage_Premiere_Cut.mp4'
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

type Dependencies = {
  relayUrl?: string
  key?: string
  canonical: () => Promise<boolean>
  fetch: typeof fetch
  now?: () => number
}

export function serveAhnikaPremiereMedia(request: Request, deps: Dependencies) {
  return serveAhnikaCut(request, deps, ahnikaPlaybackOpen, AHNIKA_PREMIERE_END)
}

export function servePrivateAhnikaCut(request: Request, slot: { start: number; end: number }, deps: Dependencies) {
  return serveAhnikaCut(request, deps, now => now >= slot.start && now < slot.end, slot.end)
}

async function serveAhnikaCut(request: Request, deps: Dependencies, withinWindow: (now: number) => boolean, endsAt: number) {
  const now = deps.now ?? Date.now
  const denied = () => new Response(null, { status: 404, headers: NO_STORE })
  const unavailable = () => new Response('Premiere media temporarily unavailable.', { status: 503, headers: NO_STORE })
  if (!withinWindow(now())) return denied()
  const range = request.headers.get('range')
  try {
    if (!await deps.canonical() || !withinWindow(now())) return denied()
    if (range && !/^bytes=(?:[0-9]{1,15}-[0-9]{0,15}|-[0-9]{1,15})$/.test(range)) {
      return new Response(null, { status: 416, headers: NO_STORE })
    }
    if (!deps.relayUrl || !deps.key) return unavailable()
    const relay = new URL(deps.relayUrl)
    if (relay.origin !== ORIGIN || relay.pathname !== RELAY || relay.username || relay.password) return unavailable()
    // Cancel in-flight origin transfers at show end as well as refusing new requests.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, endsAt - now()))])
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
    if (!withinWindow(now())) return denied()
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
      || !withinWindow(now())) {
      await video.body.cancel()
      return withinWindow(now()) ? unavailable() : denied()
    }
    const headers = new Headers({ ...NO_STORE, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' })
    if (servedRange) headers.set('Content-Range', servedRange)
    const size = video.headers.get('content-length')
    if (size && /^\d+$/.test(size)) headers.set('Content-Length', size)
    // Never forward the signer URL or upstream headers.
    return new Response(video.body, { status: video.status, headers })
  } catch {
    return withinWindow(now()) ? unavailable() : denied()
  }
}
