export const CONSENT_STORAGE_KEY = 'cafe-sativa-privacy-v1'
export const CONSENT_NOTICE_VERSION = '2026-11-08'
export const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

export type PrivacyChoices = { analytics: boolean; marketing: boolean }
export type PrivacyConsent = PrivacyChoices & {
  decided: boolean
  updatedAt: number
}
const UNKNOWN: PrivacyConsent = Object.freeze({
  analytics: false, marketing: false, decided: false, updatedAt: 0,
})

export function parseConsent(raw: string | null, now: number): PrivacyConsent {
  if (!raw) return UNKNOWN
  try {
    const value = JSON.parse(raw)
    if (value?.version !== CONSENT_NOTICE_VERSION ||
      typeof value.analytics !== 'boolean' || typeof value.marketing !== 'boolean' ||
      !Number.isFinite(value.updatedAt) || value.updatedAt > now ||
      now - value.updatedAt >= CONSENT_MAX_AGE_MS) return UNKNOWN
    return { analytics: value.analytics, marketing: value.marketing,
      decided: true, updatedAt: value.updatedAt }
  } catch { return UNKNOWN }
}

type ConsentEnvironment = {
  read: () => string | null
  write: (value: string) => void
  now: () => number
  globalPrivacyControl: () => boolean
  onWithdrawal: (persisted: boolean) => void
  onUnpersistedRejection?: () => void
}

// Testable store with a stable server snapshot and no browser access at import.
export function createPrivacyConsentStore(environment: ConsentEnvironment) {
  let current = UNKNOWN
  let deniedAfterWriteFailure: PrivacyChoices = { analytics: false, marketing: false }
  const listeners = new Set<() => void>()
  function apply(next: PrivacyConsent, withdraw: boolean, persisted = true) {
    const revoked = (current.analytics && !next.analytics) ||
      (current.marketing && !next.marketing)
    current = next
    // One broken consumer must not prevent another tracker from revoking or
    // stop the document teardown required by a withdrawal.
    listeners.forEach(listener => { try { listener() } catch {} })
    // Listeners revoke Meta consent synchronously, before the fresh document.
    if (withdraw && revoked) environment.onWithdrawal(persisted)
  }
  function refresh() {
    let next = UNKNOWN
    try { next = parseConsent(environment.read(), environment.now()) } catch {}
    next = { ...next,
      analytics: next.analytics && !deniedAfterWriteFailure.analytics,
      marketing: next.marketing && !deniedAfterWriteFailure.marketing }
    if (environment.globalPrivacyControl()) {
      next = { ...next, analytics: false, marketing: false, decided: true }
    }
    apply(next, true)
  }
  function choose(choices: PrivacyChoices) {
    const blocked = environment.globalPrivacyControl()
    const next = { analytics: choices.analytics === true && !blocked,
      marketing: choices.marketing === true && !blocked,
      decided: true, updatedAt: environment.now() }
    let persisted = true
    try {
      environment.write(JSON.stringify({ ...next, version: CONSENT_NOTICE_VERSION }))
    } catch { persisted = false }
    // Even if a previous saved grant was temporarily unreadable, a failed
    // rejection must not allow that old grant to reappear on a later refresh.
    if (!persisted && (!next.analytics || !next.marketing)) {
      deniedAfterWriteFailure = {
        analytics: !next.analytics || deniedAfterWriteFailure.analytics,
        marketing: !next.marketing || deniedAfterWriteFailure.marketing,
      }
      try { environment.onUnpersistedRejection?.() } catch {}
    }
    if (persisted) deniedAfterWriteFailure = { analytics: false, marketing: false }
    // An inaccessible store may remember only an explicit in-tab choice.
    // A reload then returns to unknown/default-denied.
    apply(next, true, persisted)
    return persisted
  }
  return {
    getSnapshot: () => current,
    getServerSnapshot: () => UNKNOWN,
    refresh, choose,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export function hasGlobalPrivacyControl() {
  return typeof navigator !== 'undefined' &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
}

const WITHDRAWAL_LATCH = 'cafe-sativa:optional-tracking-revoked'

function clearMetaCookies() {
  for (const name of ['_fbp', '_fbc']) {
    for (const domain of ['', '; Domain=cafe-sativa.com', '; Domain=.cafe-sativa.com']) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain}`
    }
  }
}

export const privacyConsent = createPrivacyConsentStore({
  read: () => window.name === WITHDRAWAL_LATCH ? null : window.localStorage.getItem(CONSENT_STORAGE_KEY),
  write: value => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, value)
    if (window.name === WITHDRAWAL_LATCH) window.name = ''
  },
  now: () => Date.now(),
  globalPrivacyControl: hasGlobalPrivacyControl,
  onUnpersistedRejection: () => { window.name = WITHDRAWAL_LATCH },
  onWithdrawal: persisted => {
    // A failed storage write must not restore an old grant after reload.
    // This non-identifying, same-tab latch survives reload and is cleared only
    // when a later explicit choice is saved successfully. Other tabs may still
    // require their site data to be cleared if browser storage is unavailable.
    try { if (!persisted) window.name = WITHDRAWAL_LATCH } catch {}
    try { clearMetaCookies() } catch {}
    // Removing a script does not unload an SDK. A fresh document is required
    // to stop code already loaded by Meta or Metricool.
    window.location.reload()
  },
})

export function startConsentSync() {
  privacyConsent.refresh()
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY || event.key === null) privacyConsent.refresh()
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') privacyConsent.refresh()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('pageshow', onVisible)
  document.addEventListener('visibilitychange', onVisible)
  const expiryCheck = window.setInterval(() => {
    const current = privacyConsent.getSnapshot()
    if (hasGlobalPrivacyControl() ||
      (current.updatedAt && Date.now() - current.updatedAt >= CONSENT_MAX_AGE_MS)) privacyConsent.refresh()
  }, 60_000)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pageshow', onVisible)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(expiryCheck)
  }
}
