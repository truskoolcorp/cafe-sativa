// Runtime policy is shared by capability, admission and recovery. This build
// contains the durable worker, but admissions remain OFF unless explicitly set.
export const DURABLE_PAYLOAD_VERSION = 2

export function durableMode(): 'off' | 'on' | 'invalid' {
  const value = process.env.CONCIERGE_DURABLE_MODE
  return !value || value === 'off' ? 'off' : value === 'on' ? 'on' : 'invalid'
}

/** Deployment-local admission gate only. Old workers need a coordinated drain. */
export function textMaintenance(): 'off' | 'on' | 'invalid' {
  const value = process.env.CONCIERGE_TEXT_MAINTENANCE
  return !value || value === 'off' ? 'off' : value === 'on' ? 'on' : 'invalid'
}

export function conciergeCapability() {
  const mode = durableMode(), maintenance = textMaintenance()
  const invalid = mode === 'invalid' || maintenance === 'invalid'
  return {
    invalid,
    durable_enabled: mode === 'on',
    durable_payload_version: DURABLE_PAYLOAD_VERSION,
    text_admissions_enabled: !invalid && maintenance === 'off',
  }
}

/** Reject before auth, quota, database or provider work. Never assert that a
 * retained request was not admitted by an earlier attempt on another worker. */
export function conciergeAdmissionDenial(req: Request) {
  const header = req.headers.get('x-concierge-durable')
  if (header !== null && header !== '0' && header !== '1') {
    return { status: 400, code: 'invalid_durable_mode', error: 'Invalid chat mode header.' }
  }
  const maintenance = textMaintenance()
  if (maintenance !== 'off') return { status: 503,
    code: maintenance === 'on' ? 'text_maintenance' : 'policy_unavailable',
    error: 'Text chat is paused. Existing messages can still be checked.' }
  const mode = durableMode()
  if (mode === 'invalid') return { status: 503, code: 'policy_unavailable', error: 'Text chat configuration is unavailable.' }
  if (header === '0' && mode !== 'off') return { status: 503, code: 'mode_changed', error: 'Chat mode changed. Please try again.' }
  if (header === '1' && mode !== 'on') return { status: 503, code: 'durable_disabled', error: 'Durable admissions are paused. Keep this request and check its status.' }
  return null
}

/** Property presence matters even for null, invalid or retained v1 values. */
export function hasDurableIdentity(value: unknown): boolean {
  return !!value && typeof value === 'object'
    && ('request_id' in value || 'issued_at' in value)
}
