import { performance } from 'node:perf_hooks'
import { projectFixedReplyReadiness, validatePlainJson, UNAVAILABLE, type Result } from './public-chat-attestation'

export const RESOURCE_LIMITS = Object.freeze({ deadlineMs: 1500, maxWaiters: 16, minReadIntervalMs: 5000, failureBackoffMs: 10000, renewAfterMs: 30000, maxBodyBytes: 262144 })
const unavailable = (): Result => ({ status: 503, body: UNAVAILABLE })
type Dependencies = { now: () => number; readCanon: (signal: AbortSignal) => Promise<unknown>; readEvent: (signal: AbortSignal) => Promise<unknown> }
function validConfig(config: unknown, now: number): boolean {
  try {
    validatePlainJson(config)
    const c = config as Record<string, unknown>
    return Object.keys(c).sort().join('|') === ['version','privateCanonicalSha256','publicReplyArtifactSha256','validFrom','validUntil'].sort().join('|') && c.version === 1 && typeof c.privateCanonicalSha256 === 'string' && /^[a-f0-9]{64}$/.test(c.privateCanonicalSha256) && typeof c.publicReplyArtifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(c.publicReplyArtifactSha256) && c.privateCanonicalSha256 !== c.publicReplyArtifactSha256 && Number.isSafeInteger(c.validFrom) && Number.isSafeInteger(c.validUntil) && Number(c.validFrom) >= 0 && Number(c.validUntil) <= 8.64e15 && Number(c.validFrom) <= now && now < Number(c.validUntil)
  } catch { return false }
}

/** Trusted server composition only. Construction performs no I/O. Never request configuration.
 * One flight per instance, including work that ignores cancellation. No background refresh.
 * A timed-out non-cooperative dependency quarantines this instance until it settles.
 */
export function createBoundedPublicChatReadiness(config: unknown, deps: Dependencies | null) {
  // Snapshot approval once. Mutating the caller object cannot change this service's approval.
  let approval: unknown = null
  try { validatePlainJson(config); approval = JSON.parse(JSON.stringify(config)) } catch { /* disabled */ }
  let previous = -1, poisoned = false, waiters = 0, nextRead = 0
  let cache: { serialized: string; started: number; expires: number; monotonicStarted: number; monotonicExpires: number } | null = null
  let flight: Promise<Result> | null = null
  let cancelFlight: (() => void) | null = null
  const now = () => {
    let t: number
    try { t = deps!.now() } catch { poisoned = true; cache = null; throw Error('unavailable') }
    if (!Number.isSafeInteger(t) || t < 0 || t > 8.64e15 || t < previous) { poisoned = true; cache = null; throw Error('unavailable') }
    previous = t
    return t
  }
  const join = async (response: Promise<Result>, signal?: AbortSignal): Promise<Result> => {
    waiters++
    let abort: (() => void) | undefined
    const canceled = new Promise<Result>(resolve => {
      abort = () => resolve(unavailable())
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
    try { return await Promise.race([response, canceled]) }
    finally {
      if (abort) signal?.removeEventListener('abort', abort)
      waiters--
      if (waiters === 0) cancelFlight?.()
    }
  }
  return async function readiness(signal?: AbortSignal): Promise<Result> {
    if (signal?.aborted || !deps || !approval || poisoned) return unavailable()
    let at: number
    try { at = now(); if (!validConfig(approval, at)) { cache = null; return unavailable() } } catch { return unavailable() }
    if (flight) {
      if (waiters >= RESOURCE_LIMITS.maxWaiters) return unavailable()
      return join(flight, signal)
    }
    if (cache && at < cache.expires && at - cache.started < RESOURCE_LIMITS.renewAfterMs && performance.now() < cache.monotonicExpires && performance.now() - cache.monotonicStarted < RESOURCE_LIMITS.renewAfterMs) return JSON.parse(cache.serialized) as Result
    cache = null // Never serve stale success while renewing, after failure, or in backoff.
    if (at < nextRead) return unavailable()
    nextRead = at + RESOURCE_LIMITS.minReadIntervalMs
    const monotonicStart = performance.now()
    const controller = new AbortController()
    let closed = false
    let timeout: ReturnType<typeof setTimeout>
    const deadline = new Promise<Result>(resolve => {
      cancelFlight = () => { if (closed) return; closed = true; cache = null; controller.abort(); resolve(unavailable()) }
      timeout = setTimeout(cancelFlight, RESOURCE_LIMITS.deadlineMs)
    })
    // allSettled holds the slot until BOTH operations settle, even after an early failure.
    const work = Promise.allSettled([
      Promise.resolve().then(() => deps.readCanon(controller.signal)),
      Promise.resolve().then(() => deps.readEvent(controller.signal)),
    ]).then(values => {
      if (closed || poisoned) return unavailable()
      const finished = now()
      if (performance.now() - monotonicStart >= RESOURCE_LIMITS.deadlineMs || finished - at >= RESOURCE_LIMITS.deadlineMs || !validConfig(approval, finished) || values.some(v => v.status !== 'fulfilled')) return unavailable()
      const [canon, event] = values as PromiseFulfilledResult<unknown>[]
      const result = projectFixedReplyReadiness(approval, canon.value, event.value, at, finished)
      if (performance.now() - monotonicStart >= RESOURCE_LIMITS.deadlineMs) return unavailable()
      if (result.status === 200) {
        const body = result.body as { observation: { startedAt: string; expiresAt: string } }
        const started = Date.parse(body.observation.startedAt), expires = Date.parse(body.observation.expiresAt)
        cache = { serialized: JSON.stringify(result), started, expires, monotonicStarted: monotonicStart - (at - started), monotonicExpires: monotonicStart + (expires - at) }
      }
      return result
    }).catch(() => unavailable())
    const response = Promise.race([work, deadline]).then(result => {
      if (result.status !== 200) { cache = null; controller.abort(); nextRead = Math.max(nextRead, previous + RESOURCE_LIMITS.failureBackoffMs) }
      closed = true
      clearTimeout(timeout)
      return result
    })
    flight = response
    // Cleanup only; late results cannot cache, clear another flight, or start more work.
    void work.then(() => response).then(() => { flight = null; cancelFlight = null })
    return join(response, signal)
  }
}

/** Bounds bytes BEFORE parsing; rejects non-JSON, redirected, malformed and oversized bodies.
 * Signal must also be passed to fetch so cancellation spans headers AND body.
 * No racing-away reads here: a non-cooperative reader keeps the service slot occupied.
 */
export async function readBoundedPublicChatJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted || !response.ok || response.redirected || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) { if (response.body) await response.body.cancel(); throw Error('unavailable') }
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > RESOURCE_LIMITS.maxBodyBytes)) { await response.body.cancel(); throw Error('unavailable') }
  const reader = response.body.getReader()
  let bytes = 0, reads = 0
  let cancellation: Promise<void> | null = null
  const cancel = () => { cancellation ??= reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      if (signal.aborted || ++reads > 1024) throw Error('unavailable')
      if (reads % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      const part = await reader.read()
      if (signal.aborted) throw Error('unavailable')
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > RESOURCE_LIMITS.maxBodyBytes) throw Error('unavailable')
      chunks.push(part.value)
    }
    const buffer = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    const parsed: unknown = JSON.parse(text)
    rejectDuplicateKeys(text)
    validatePlainJson(parsed)
    return parsed
  } catch { cancel(); throw Error('unavailable') }
  finally { signal.removeEventListener('abort', cancel); if (cancellation) await cancellation; reader.releaseLock() }
}

// JSON.parse already validated grammar. This bounded second pass rejects duplicate
// decoded property names (including escape aliases), rather than last-key-wins.
function rejectDuplicateKeys(text: string): void {
  let i = 0, nodes = 0
  const whitespace = () => { while (/\s/.test(text[i] || '') && i < text.length) i++ }
  const string = (): string => {
    const begin = i++
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i++] === '"') return JSON.parse(text.slice(begin, i)) as string
    }
    throw Error('unavailable')
  }
  const visit = (depth: number): void => {
    if (++nodes > 10000 || depth > 32) throw Error('unavailable')
    whitespace()
    if (text[i] === '"') { string(); return }
    if (text[i] === '{') {
      i++; whitespace(); const keys = new Set<string>()
      if (text[i] === '}') { i++; return }
      while (true) {
        whitespace(); const key = string()
        if (keys.has(key)) throw Error('unavailable')
        keys.add(key); whitespace(); i++; visit(depth + 1); whitespace()
        if (text[i++] === '}') return
      }
    }
    if (text[i] === '[') {
      i++; whitespace()
      if (text[i] === ']') { i++; return }
      while (true) { visit(depth + 1); whitespace(); if (text[i++] === ']') return }
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i])) i++
  }
  visit(0)
}
