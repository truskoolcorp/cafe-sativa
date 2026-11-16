import type { SupabaseClient } from '@supabase/supabase-js'
import { readPromoMetricoolBrands, PromoConnectionReadError } from './character-promo-metricool-readonly'

export type PromoDispatchMetricoolMethod = 'getBrandSettings' | 'getScheduledPosts' | 'createScheduledPost'
export type PromoDispatchConnectionSession = {
  call(name: PromoDispatchMetricoolMethod, args: object): Promise<unknown>
  preflight(): Promise<void>
}
export type PromoDispatchConnectionDependencies = {
  db: Pick<SupabaseClient, 'from' | 'auth'>
  decrypt(ciphertext: string): unknown
  openSession(token: string): Promise<{call(name: PromoDispatchMetricoolMethod, args: object): Promise<unknown>}>
  now(): number
}

const messages = {
  metricool_connection_missing: 'Existing authorized Metricool connection unavailable',
  metricool_connection_revoked: 'Existing Metricool connection is not the verified Tru Skool mapping',
  metricool_reconnect_required: 'Metricool bearer access is expired, expiring or unverified; reconnect outside dispatch',
  metricool_owner_unavailable: 'Connection owner is no longer an authorized administrator',
  metricool_connection_changed: 'Metricool authorization changed; dispatch session is closed',
  metricool_session_expired: 'Metricool dispatch session deadline elapsed',
  metricool_operation_not_allowed: 'Metricool operation is not permitted for this dispatch session',
  metricool_dispatch_failed: 'Metricool dispatch connection failed; no automatic retry was attempted',
} as const
type ErrorCode = keyof typeof messages
export class PromoDispatchConnectionError extends Error {
  constructor(readonly code: ErrorCode) {
    super(messages[code])
    this.name = 'PromoDispatchConnectionError'
  }
}
function sanitized(error: unknown): PromoDispatchConnectionError {
  // Never preserve an injected/provider message, cause, response, or token.
  if ((error instanceof PromoDispatchConnectionError || error instanceof PromoConnectionReadError)
    && Object.prototype.hasOwnProperty.call(messages, error.code)) {
    return new PromoDispatchConnectionError(error.code as ErrorCode)
  }
  return new PromoDispatchConnectionError('metricool_dispatch_failed')
}

const columns = 'provider,owner_id,status,brand_id,user_id,credential_ciphertext,last_error,updated_at'
const pinFields = ['provider', 'owner_id', 'status', 'brand_id', 'user_id', 'credential_ciphertext', 'last_error', 'updated_at'] as const
type ConnectionPin = Record<typeof pinFields[number], unknown>

/** Dormant, injected factory. Invoke ONLY after a durable claim and private-media read.
 * Reuses the read-only bearer authorization path without locks, refreshes or writes.
 * updated_at is a real schema field, not a guaranteed monotonic revision: its schema
 * has no automatic update trigger. A changed timestamp catches revoke/restore ABA,
 * but an unseen revoke/restore that leaves EVERY pinned field unchanged cannot be
 * detected here. These reads are not atomic with an external provider operation.
 * The caller must retain its separate durable actor/approval preflight as well.
 */
export async function openCharacterPromoDispatchSession(deps: PromoDispatchConnectionDependencies): Promise<PromoDispatchConnectionSession> {
  let pin: ConnectionPin
  let obtainedAt = NaN, expiresAt = NaN, deadline: number | null = null
  let raw: Awaited<ReturnType<PromoDispatchConnectionDependencies['openSession']>> | null = null
  let closed: PromoDispatchConnectionError | null = null
  let createAttempted = false

  const fail = (error: unknown): never => {
    closed = closed || sanitized(error)
    throw new PromoDispatchConnectionError(closed.code)
  }
  const read = async (): Promise<ConnectionPin> => {
    const result = await deps.db.from('cs_social_connections').select(columns).eq('provider', 'metricool').maybeSingle()
    const row = result.data
    if (result.error || !row || row.provider !== 'metricool'
      || typeof row.owner_id !== 'string' || !row.owner_id
      || typeof row.credential_ciphertext !== 'string' || !row.credential_ciphertext
      || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))
      || (row.last_error !== null && typeof row.last_error !== 'string')) {
      throw new PromoDispatchConnectionError('metricool_connection_missing')
    }
    // Copy primitives rather than keeping a mutable database response as the pin.
    return Object.freeze(Object.fromEntries(pinFields.map(key => [key, row[key]]))) as ConnectionPin
  }
  const checkTime = () => {
    const now = deps.now()
    if (!Number.isFinite(now) || !Number.isFinite(obtainedAt) || obtainedAt > now
      || !Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
      throw new PromoDispatchConnectionError('metricool_reconnect_required')
    }
    if (deadline !== null && now >= deadline) throw new PromoDispatchConnectionError('metricool_session_expired')
  }
  const preflight = async (): Promise<void> => {
    try {
      if (closed) throw closed
      checkTime()
      const row = await read()
      if (pinFields.some(key => row[key] !== pin[key])) throw new PromoDispatchConnectionError('metricool_connection_changed')
      const owner = await deps.db.auth.admin.getUserById(pin.owner_id as string)
      if (owner.error || owner.data.user?.app_metadata?.cafe_sativa_admin !== true) {
        throw new PromoDispatchConnectionError('metricool_owner_unavailable')
      }
      checkTime()
    } catch (error) { fail(error) }
  }

  try {
    pin = await read()
    await readPromoMetricoolBrands({
      db: deps.db,
      now: deps.now,
      decrypt(ciphertext) {
        if (ciphertext !== pin.credential_ciphertext) throw new PromoDispatchConnectionError('metricool_connection_changed')
        const credentials = deps.decrypt(ciphertext) as Record<string, unknown> | null
        obtainedAt = Date.parse(typeof credentials?.obtainedAt === 'string' ? credentials.obtainedAt : '')
        expiresAt = obtainedAt + Number(credentials?.expires_in) * 1000
        return credentials
      },
      async openSession(token) {
        await preflight()
        // Start once, immediately before opening the existing 25-second session.
        // Private-media work happens before this factory, never in a preflight.
        deadline = deps.now() + 25_000
        raw = await deps.openSession(token)
        checkTime()
        return {
          async call(name, args) {
            await preflight()
            const value = await raw!.call(name, args)
            checkTime()
            return value
          },
        }
      },
    })
    await preflight()
    if (!raw) throw new PromoDispatchConnectionError('metricool_dispatch_failed')
  } catch (error) { fail(error) }

  return Object.freeze({
    preflight,
    async call(name: PromoDispatchMetricoolMethod, args: object): Promise<unknown> {
      try {
        if (closed) throw closed
        if (!['getBrandSettings', 'getScheduledPosts', 'createScheduledPost'].includes(name)
          || !args || typeof args !== 'object' || Array.isArray(args)) {
          throw new PromoDispatchConnectionError('metricool_operation_not_allowed')
        }
        await preflight()
        if (name === 'createScheduledPost') {
          // The attempt is consumed before invoking the provider, including throws
          // or uncertain outcomes. A second caller cannot retry the same session.
          if (createAttempted) throw new PromoDispatchConnectionError('metricool_operation_not_allowed')
          createAttempted = true
        }
        const value = await raw!.call(name, args)
        await preflight()
        return value
      } catch (error) { return fail(error) }
    },
  })
}
