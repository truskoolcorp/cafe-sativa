import { isSafePixelLocation, isSafePixelReferrer } from './meta-pixel'

type MetricoolWindow = Window & { beTracker?: { t: (options: { hash: string }) => void } }
const SCRIPT_ID = 'metricool-cafe-sativa'

export function createMetricoolController(win: MetricoolWindow, doc: Document) {
  let script: HTMLScriptElement | undefined
  let granted = false
  let enabled = false
  let started = false
  let ready = false
  const permitted = () => enabled && granted && isSafePixelLocation(win.location.href) &&
    isSafePixelReferrer(doc.referrer)
  function start() {
    if (ready && permitted() && !started && win.beTracker) {
      started = true
      win.beTracker.t({ hash: 'a0d4d05a33de207c57b5029ffc12d1e0' })
    }
  }
  function sync(nextEnabled: boolean, nextGranted: boolean) {
    enabled = nextEnabled
    granted = nextGranted
    if (!permitted() || started) return
    if (script) { start(); return }
    if (win.beTracker || doc.getElementById(SCRIPT_ID)) return
    script = doc.createElement('script')
    script.id = SCRIPT_ID
    script.async = true
    script.src = 'https://tracker.metricool.com/resources/be.js'
    script.onload = () => { ready = true; start() }
    script.onerror = () => { script?.remove(); script = undefined; ready = false }
    doc.head.appendChild(script)
  }
  // Metricool has no verified stop API. Consent withdrawal must reload the
  // document through the consent store, not just remove this script element.
  return { sync }
}

let controller: ReturnType<typeof createMetricoolController> | undefined
export function getMetricoolController() {
  if (!controller) controller = createMetricoolController(window, document)
  return controller
}
