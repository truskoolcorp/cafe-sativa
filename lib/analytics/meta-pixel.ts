export const CAFE_META_PIXEL_ID = '1079070821826891'
const SCRIPT_ID = 'cafe-meta-pixel'
const SCRIPT_URL = 'https://connect.facebook.net/en_US/fbevents.js'

// Deliberately narrow initial scope. Never instrument accounts, payments,
// private events, AI conversations, or authentication callbacks by default.
const PUBLIC_PATHS = new Set([
  '/', '/membership', '/events', '/events/hit-em-release-party',
])

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[][]
  push?: Fbq
  loaded: boolean
  version: string
}

type PixelWindow = Window & { fbq?: Fbq; _fbq?: Fbq }

export function isSafePixelLocation(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' &&
      ['www.cafe-sativa.com', 'cafe-sativa.com'].includes(parsed.hostname) &&
      !parsed.username && !parsed.password && !parsed.port &&
      PUBLIC_PATHS.has(parsed.pathname) && !parsed.search && !parsed.hash
  } catch { return false }
}

export function isSafePixelReferrer(referrer: string): boolean {
  if (referrer === '') return true
  try {
    const parsed = new URL(referrer)
    if (['www.cafe-sativa.com', 'cafe-sativa.com'].includes(parsed.hostname)) {
      return isSafePixelLocation(referrer)
    }
    // Cross-site referrers normally contain only the origin. Do not expose
    // another site's path, search terms or identifiers without review.
    return parsed.protocol === 'https:' && parsed.pathname === '/' &&
      !parsed.search && !parsed.hash && !parsed.username && !parsed.password && !parsed.port
  } catch { return false }
}

export function createMetaPixelController(win: PixelWindow, doc: Document) {
  let script: HTMLScriptElement | undefined
  let fbq: Fbq | undefined
  let ready = false
  let initialized = false
  let active = false
  let lastPage: string | undefined
  let currentPage: string | undefined

  function emitPage() {
    if (!ready || !active || !fbq || !currentPage) return
    // Check again after async loading so a stale consent or navigation cannot
    // emit a pageview for an unapproved current URL.
    if (!isSafePixelLocation(win.location.href) || !isSafePixelReferrer(doc.referrer) ||
      win.location.href !== currentPage) return
    if (!initialized) {
      fbq('set', 'autoConfig', false, CAFE_META_PIXEL_ID)
      fbq('init', CAFE_META_PIXEL_ID)
      initialized = true
    }
    fbq('consent', 'grant')
    if (lastPage !== currentPage) {
      fbq('trackSingle', CAFE_META_PIXEL_ID, 'PageView')
      lastPage = currentPage
    }
  }

  function deactivate() {
    active = false
    currentPage = undefined
    // No events are queued before onload. A revoke during loading cannot
    // release a previously queued pageview after the script arrives.
    if (ready && initialized && fbq) fbq('consent', 'revoke')
  }

  function sync(enabled: boolean, granted: boolean) {
    // Cleanup/remount and repeated consent callbacks on the same visit are
    // not new pageviews. A genuinely different URL resets this guard.
    if (lastPage && win.location.href !== lastPage) lastPage = undefined
    if (!enabled || !granted || !isSafePixelLocation(win.location.href) ||
      !isSafePixelReferrer(doc.referrer)) {
      deactivate()
      return
    }
    // Refuse to overwrite or share another integration's global tracker.
    if ((win.fbq && win.fbq !== fbq) || (win._fbq && win._fbq !== fbq) ||
      (!fbq && doc.getElementById(SCRIPT_ID))) {
      deactivate()
      return
    }
    active = true
    currentPage = win.location.href
    if (!fbq) {
      const queue = function (...args: unknown[]) {
        if (queue.callMethod) queue.callMethod(...args)
        else queue.queue.push(args)
      } as Fbq
      queue.queue = []
      queue.push = queue
      queue.loaded = true
      queue.version = '2.0'
      fbq = queue
      win.fbq = queue
      win._fbq = queue
    }
    if (!script) {
      script = doc.createElement('script')
      script.id = SCRIPT_ID
      script.async = true
      script.src = SCRIPT_URL
      script.onload = () => { ready = true; emitPage() }
      script.onerror = () => {
        script?.remove()
        script = undefined
        ready = false
        deactivate()
      }
      doc.head.appendChild(script)
    }
    emitPage()
  }

  return { sync, deactivate }
}

let controller: ReturnType<typeof createMetaPixelController> | undefined

export function getMetaPixelController() {
  // Called only from a client effect, never during server rendering.
  if (!controller) controller = createMetaPixelController(window, document)
  return controller
}
