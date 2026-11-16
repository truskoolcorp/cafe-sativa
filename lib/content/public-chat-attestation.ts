import { createHash } from 'node:crypto'
import { HIT_EM_PREMIERE as EVENT } from '../events/hit-em-premiere'

// Server-use only. Private pins and source objects must never be returned/logged.
const SHA = /^[a-f0-9]{64}$/
const TTL = 60_000
const CHARACTER = 'laviche-fea'
type Obj = Record<string, unknown>
function obj(x: unknown): Obj {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('unavailable')
  return x as Obj
}
function exact(x: Obj, keys: string[]) {
  if (Object.keys(x).sort().join('|') !== keys.sort().join('|')) throw Error('unavailable')
}
function time(x: unknown): number {
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0 || x > 8.64e15) throw Error('unavailable')
  return x
}
// Only bounded, ordinary JSON data is admissible. Inspect descriptors before values:
// getters, holes, custom prototypes and ignored properties cannot disappear in a pin.
function stable(input: unknown): string {
  let nodes = 0, units = 0
  const seen = new WeakSet<object>()
  function piece(text: string): string {
    units += text.length
    if (units > 262144) throw Error('unavailable')
    return text
  }
  function visit(x: unknown, depth: number): string {
    if (++nodes > 10000 || depth > 32) throw Error('unavailable')
    if (x === null || typeof x === 'boolean') return piece(JSON.stringify(x))
    if (typeof x === 'string') {
      if (x.length > 262144) throw Error('unavailable')
      return piece(JSON.stringify(x))
    }
    if (typeof x === 'number' && Number.isFinite(x) && !Object.is(x, -0)) return piece(JSON.stringify(x))
    if (!x || typeof x !== 'object' || seen.has(x)) throw Error('unavailable')
    seen.add(x)
    const array = Array.isArray(x)
    if (Object.getPrototypeOf(x) !== (array ? Array.prototype : Object.prototype)) throw Error('unavailable')
    const keys = Reflect.ownKeys(x)
    if (keys.length > 10001 || keys.some(k => typeof k !== 'string')) throw Error('unavailable')
    const descriptors = Object.getOwnPropertyDescriptors(x)
    const fields = (keys as string[]).filter(k => !(array && k === 'length'))
    for (const key of fields) {
      const d = descriptors[key]
      if (!d.enumerable || !('value' in d)) throw Error('unavailable')
    }
    if (array) {
      if (x.length > 10000 || fields.length !== x.length) throw Error('unavailable')
      const parts: string[] = []
      for (let i = 0; i < x.length; i++) {
        const d = descriptors[String(i)]
        if (!d || !d.enumerable || !('value' in d)) throw Error('unavailable')
        parts.push(visit(d.value, depth + 1))
      }
      if (parts.length > 1) piece(','.repeat(parts.length - 1))
      return piece('[') + parts.join(',') + piece(']')
    }
    const parts = fields.sort().map(k => {
      if (k.length > 262144) throw Error('unavailable')
      return piece(JSON.stringify(k)) + piece(':') + visit(descriptors[k].value, depth + 1)
    })
    // Charge separators once, without charging already bounded child strings again.
    if (parts.length > 1) piece(','.repeat(parts.length - 1))
    return piece('{') + parts.join(',') + piece('}')
  }
  return visit(input, 0)
}
export function validatePlainJson(value: unknown): void { stable(value) }
// Internal review tooling only; never include this digest in any public output.
export function privateCanonicalDigest(row: unknown): string {
  const serialized = stable(row)
  if (serialized.length > 262144) throw Error('unavailable')
  return createHash('sha256').update(serialized).digest('hex')
}
export type Providers = {
  // Adapters supply verified conservative observation lower bounds, never cache
  // receipt times. The trusted adapter validates the original upstream completion
  // timestamp before using its fresh request start as this interval boundary.
  readCanon: () => Promise<unknown>
  readEvent: () => Promise<unknown>
  now: () => number
}
export const UNAVAILABLE = Object.freeze({ error: 'Readiness unavailable' })
export type Result = { status: 200 | 503; body: object }
export function projectFixedReplyReadiness(config: unknown, canonEvidence: unknown, eventEvidence: unknown, started: number, finished: number): Result {
  try {
    // Validate entire trust-boundary values before reading any properties.
    stable(config); stable(canonEvidence); stable(eventEvidence)
    const c = obj(config)
    exact(c, ['version', 'privateCanonicalSha256', 'publicReplyArtifactSha256', 'validFrom', 'validUntil'])
    if (c.version !== 1 || typeof c.privateCanonicalSha256 !== 'string' || !SHA.test(c.privateCanonicalSha256) || typeof c.publicReplyArtifactSha256 !== 'string' || !SHA.test(c.publicReplyArtifactSha256) || c.publicReplyArtifactSha256 === c.privateCanonicalSha256) throw Error('unavailable')
    const begin = time(started), end = time(finished), from = time(c.validFrom), until = time(c.validUntil)
    if (from >= until || begin < from || end >= until || end < begin || end - begin >= TTL) throw Error('unavailable')
    const a = obj(canonEvidence), b = obj(eventEvidence)
    for (const e of [a, b]) {
      exact(e, ['originObservedAt', 'liveRead', 'value'])
      const at = time(e.originObservedAt)
      if (e.liveRead !== true || at > end || end - at >= TTL) throw Error('unavailable')
    }
    const source = obj(a.value)
    exact(source, ['live', 'characters'])
    if (source.live !== true || !Array.isArray(source.characters) || source.characters.length > 100) throw Error('unavailable')
    const matches = source.characters.filter(r => obj(r).id === CHARACTER)
    if (matches.length !== 1) throw Error('unavailable')
    const row = obj(matches[0])
    if (row.production_ready !== true || row.rights_status !== 'approved' || row.voice_status !== 'canonical' || typeof row.voice_id !== 'string' || !row.voice_id.trim() || typeof row.canonical_context !== 'string' || !row.canonical_context.trim() || privateCanonicalDigest(row) !== c.privateCanonicalSha256) throw Error('unavailable')
    const event = obj(b.value)
    exact(event, ['id', 'slug', 'title', 'starts_at', 'video_id', 'visibility', 'ticket_price_cents', 'status'])
    if (event.id !== EVENT.eventId || event.slug !== EVENT.slug || event.title !== EVENT.title || event.starts_at !== EVENT.startsAt || event.video_id !== EVENT.videoId || event.visibility !== 'public' || event.ticket_price_cents !== 0 || typeof event.status !== 'string' || !['scheduled', 'live'].includes(event.status)) throw Error('unavailable')
    const earliest = Math.min(begin, time(a.originObservedAt), time(b.originObservedAt))
    const expires = Math.min(earliest + TTL, until)
    if (expires <= end) throw Error('unavailable')
    return { status: 200, body: {
      contract: 'cafe-fixed-public-replies/v1', scope: 'fixed-replies-only', ready: true,
      event: { id: EVENT.eventId, videoId: EVENT.videoId, startsAt: EVENT.startsAt },
      publicReplyArtifactSha256: c.publicReplyArtifactSha256,
      observation: { startedAt: new Date(earliest).toISOString(), completedAt: new Date(end).toISOString(), expiresAt: new Date(expires).toISOString() },
    } }
  } catch { return { status: 503, body: UNAVAILABLE } }
}
export async function evaluateFixedReplyReadiness(config: unknown, providers: Providers | null): Promise<Result> {
  if (!config || !providers) return { status: 503, body: UNAVAILABLE }
  try {
    const started = providers.now()
    const canon = await providers.readCanon()
    const afterCanon = providers.now()
    if (time(afterCanon) < time(started)) throw Error('unavailable')
    const event = await providers.readEvent()
    const finished = providers.now()
    if (time(finished) < afterCanon) throw Error('unavailable')
    return projectFixedReplyReadiness(config, canon, event, started, finished)
  } catch { return { status: 503, body: UNAVAILABLE } }
}
