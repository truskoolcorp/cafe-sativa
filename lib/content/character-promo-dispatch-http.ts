import type { PromoReceipt } from './character-promo-delivery'

export type PromoDispatchInput = {
  planId: string
  reviewedDigest: string
  explicitConfirmation: true
  transmitApprovedVideo: true
}

export type PromoDispatchHttpDependencies = {
  enabled(): boolean
  authorize(): Promise<boolean>
  dispatch(body: PromoDispatchInput): Promise<unknown>
}

export const PROMO_DISPATCH_MAX_BODY_BYTES = 4096
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SHA = /^[a-f0-9]{64}$/
const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Vary: 'Cookie, Origin',
}
const reply = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...HEADERS, ...headers } })
class InputFault extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

async function readInput(request: Request): Promise<PromoDispatchInput> {
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > PROMO_DISPATCH_MAX_BODY_BYTES)) {
    throw new InputFault(413, 'request_too_large')
  }
  if (!request.body) throw new InputFault(400, 'body_required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > PROMO_DISPATCH_MAX_BODY_BYTES) {
        // Cancellation failures cannot replace the bounded-input rejection.
        try { await reader.cancel() } catch { /* No dispatch occurred. */ }
        throw new InputFault(413, 'request_too_large')
      }
      chunks.push(part.value)
    }
  } catch (error) {
    if (error instanceof InputFault) throw error
    throw new InputFault(400, 'body_unreadable')
  } finally {
    reader.releaseLock()
  }
  if (declared !== null && Number(declared) !== length) throw new InputFault(400, 'body_length_mismatch')
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new InputFault(400, 'invalid_json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputFault(400, 'invalid_dispatch_input')
  const body = value as Record<string, unknown>
  const keys = ['planId', 'reviewedDigest', 'explicitConfirmation', 'transmitApprovedVideo']
  if (Object.keys(body).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(body, key)) ||
      typeof body.planId !== 'string' || !UUID.test(body.planId) ||
      typeof body.reviewedDigest !== 'string' || !SHA.test(body.reviewedDigest) ||
      body.explicitConfirmation !== true || body.transmitApprovedVideo !== true) {
    throw new InputFault(400, 'invalid_dispatch_input')
  }
  // Copy only the four supported fields. No actor, account, media URL or snapshot input.
  return { planId: body.planId, reviewedDigest: body.reviewedDigest, explicitConfirmation: true, transmitApprovedVideo: true }
}

function safeReceipt(value: unknown, digest: string): PromoReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v)
  if (row.state !== 'scheduled' || row.snapshotDigest !== digest ||
      typeof row.videoSha256 !== 'string' || !SHA.test(row.videoSha256) ||
      !id(row.providerId) || !id(row.providerUuid) || !id(row.accountId) ||
      (row.network !== 'facebook' && row.network !== 'threads') || row.brandId !== '5373515' || row.userId !== '4174093' ||
      typeof row.caption !== 'string' || !row.caption.trim() || Array.from(row.caption).length > 500 ||
      typeof row.scheduledAt !== 'string' || !Number.isFinite(Date.parse(row.scheduledAt)) || new Date(row.scheduledAt).toISOString() !== row.scheduledAt ||
      typeof row.timezone !== 'string' || row.timezone.length > 100) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: row.timezone }) } catch { return null }
  return {
    providerId: row.providerId, providerUuid: row.providerUuid, snapshotDigest: digest,
    videoSha256: row.videoSha256, network: row.network, accountId: row.accountId,
    brandId: row.brandId, userId: row.userId, caption: row.caption,
    scheduledAt: row.scheduledAt, timezone: row.timezone, state: 'scheduled',
  }
}

const unknownOutcome = () => reply({
  status: 'submission_unknown', publicationConfirmed: false, code: 'dispatch_outcome_unconfirmed',
  error: 'Scheduling outcome is unconfirmed. Do not retry. Manual reconciliation is required.',
}, 503)

/** One explicit, same-origin POST. Disabled requests never authenticate or access services.
 * Authorization and durable one-shot claiming remain server responsibilities. No retries.
 */
export function createPromoDispatchHandler(deps: PromoDispatchHttpDependencies) {
  return async (request: Request): Promise<Response> => {
    let enabled = false
    try { enabled = deps.enabled() === true } catch { /* Fail closed before authentication. */ }
    if (!enabled) return reply({ status: 'disabled', publicationConfirmed: false, code: 'dispatch_runtime_disabled' }, 503)
    if (request.method !== 'POST') return reply({ error: 'POST required.', code: 'method_not_allowed' }, 405, { Allow: 'POST' })
    const site = request.headers.get('sec-fetch-site')
    if (request.headers.get('origin') !== new URL(request.url).origin || (site !== null && site !== 'same-origin')) {
      return reply({ error: 'Same-origin explicit confirmation required.', code: 'origin_rejected' }, 403)
    }
    if (!/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(request.headers.get('content-type') || '')) {
      return reply({ error: 'JSON confirmation required.', code: 'json_required' }, 415)
    }
    try { if (await deps.authorize() !== true) return reply({ error: 'Unauthorized.', code: 'unauthorized' }, 401) }
    catch { return reply({ error: 'Unauthorized.', code: 'unauthorized' }, 401) }
    let input: PromoDispatchInput
    try { input = await readInput(request) }
    catch (error) {
      return error instanceof InputFault
        ? reply({ error: 'Exact bounded dispatch confirmation required. No dispatch was started.', code: error.code }, error.status)
        : reply({ error: 'Dispatch confirmation could not be read. No dispatch was started.', code: 'body_unreadable' }, 400)
    }
    try {
      const result = await deps.dispatch(input)
      if (!result || typeof result !== 'object' || Array.isArray(result)) return unknownOutcome()
      const value = result as Record<string, unknown>
      if (value.status === 'scheduled' && value.publicationConfirmed === false) {
        const receipt = safeReceipt(value.receipt, input.reviewedDigest)
        return receipt ? reply({ status: 'scheduled', publicationConfirmed: false, receipt }, 200) : unknownOutcome()
      }
      if (value.status === 'disabled') return reply({ status: 'disabled', publicationConfirmed: false }, 503)
      if (value.status === 'blocked' || value.status === 'already_claimed_or_stale') {
        return reply({ status: value.status, publicationConfirmed: false, error: 'Dispatch is unavailable. Review current evidence and reconcile any existing attempt before further action.' }, 409)
      }
      return unknownOutcome()
    } catch { return unknownOutcome() }
  }
}
