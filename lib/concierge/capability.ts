// This preparation release has no durable worker or ledger. Environment flags
// cannot turn it into one. Keep the wire version separate from availability.
export const DURABLE_PAYLOAD_VERSION = 2

export function conciergeCapability() {
  const mode = process.env.CONCIERGE_DURABLE_MODE
  const maintenance = process.env.CONCIERGE_TEXT_MAINTENANCE
  const invalid = (!!mode && mode !== 'off')
    || (!!maintenance && maintenance !== 'off' && maintenance !== 'on')
  return {
    invalid,
    durable_enabled: false as const,
    durable_payload_version: DURABLE_PAYLOAD_VERSION,
    text_admissions_enabled: !invalid && maintenance !== 'on',
  }
}

/** These gates run before auth, quota, database or provider work. They make no
 * claim about earlier attempts at an original request, even on rejection. */
export function conciergeAdmissionDenial(req: Request) {
  const header = req.headers.get('x-concierge-durable')
  if (header !== null && header !== '0' && header !== '1') {
    return { status: 400, code: 'invalid_durable_mode', error: 'Invalid chat mode header.' }
  }
  const capability = conciergeCapability()
  if (capability.invalid) return { status: 503, code: 'policy_unavailable', error: 'Text chat configuration is unavailable.' }
  if (!capability.text_admissions_enabled) return { status: 503, code: 'text_maintenance', error: 'Text chat is temporarily paused.' }
  if (header === '1') return { status: 409, code: 'mode_changed', error: 'Durable chat is not available on this deployment. Keep the original request.' }
  return null
}

/** Do not silently strip a retained durable identity and send it as legacy. */
export function hasDurableIdentity(value: unknown): boolean {
  return !!value && typeof value === 'object'
    && ('request_id' in value || 'issued_at' in value)
}

export function conciergeRequesterValid(req: Request): boolean {
  const expected = req.headers.get('x-concierge-requester')
  if (expected === null) return req.headers.get('x-concierge-durable') === null
  if (/^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected)) return true
  if (!expected.startsWith('guest:')) return false
  const session = expected.slice(6)
  return session.length > 0 && session.length <= 256 && session === session.trim()
    && !/[\u0000-\u001f\u007f]/.test(session)
}

/** A browser expectation is a fence, never authority to select an identity. */
export function conciergeRequesterMatches(req: Request, userId: string | null, sessionId: string | null): boolean {
  const expected = req.headers.get('x-concierge-requester')
  if (expected === null) return req.headers.get('x-concierge-durable') === null
  return expected === (userId ? `user:${userId}` : `guest:${sessionId}`)
}
