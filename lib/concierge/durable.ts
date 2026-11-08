import Anthropic from '@anthropic-ai/sdk'
import { canonicalConciergeHost } from '@/lib/content/concierge-canon'
import { getSiteContent } from '@/lib/content/site'
import { getUpcomingEvents, type EventRow } from '@/lib/events'
import { getHost } from './personas'
import { getMemoryContext } from './memory'
import { chronologicalMessages } from './history'
import { type ConciergeRequest, UUID_PATTERN } from './request'
import type { Tier } from './rate-limit'
import { conciergeEventFacts, PROGRAMMING_FACT_RULES, verifiedPremiereAnswer } from './programming'
import { jsonWithCors } from '@/lib/cors'

// Technical envelope, not a dollar budget. SQL policy can only narrow these.
export const DURABLE_LIMITS = { max_prompt_bytes: 48000, max_input_messages: 61, max_output_tokens: 512, max_reply_chars: 16384 }
export function durableMode(): 'off' | 'on' | 'invalid' {
  const value = process.env.CONCIERGE_DURABLE_MODE
  return !value || value === 'off' ? 'off' : value === 'on' ? 'on' : 'invalid'
}
/** Deployment-local admission gate only. Old workers need a coordinated drain. */
export function textMaintenance(): 'off' | 'on' | 'invalid' {
  const value = process.env.CONCIERGE_TEXT_MAINTENANCE
  return !value || value === 'off' ? 'off' : value === 'on' ? 'on' : 'invalid'
}
export function durablePayload(body: ConciergeRequest) {
  // Omit issued_at entirely for retained v1 bodies to preserve their hashes.
  return { ...(body.issued_at == null ? { version: 1 } : { version: 2, issued_at: body.issued_at }), host: body.host, message: body.message, conversation_id: body.conversation_id,
    surface: body.surface, room_id: body.room_id }
}
/** Only bounded opaque identifiers and token counts, never provider content or
 * exception bodies. A receipt is evidence to inspect, not dispatch authority. */
export function sanitizedProviderReceipt(value: unknown) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const usage = source.usage && typeof source.usage === 'object' ? source.usage as Record<string, unknown> : {}
  const id = (candidate: unknown) => typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidate) ? candidate : null
  const tokens = (candidate: unknown) => typeof candidate === 'number' && Number.isSafeInteger(candidate)
    && candidate >= 0 && candidate <= 2147483647 ? candidate : null
  return { request_id: id(source._request_id), message_id: id(source.id),
    input_tokens: tokens(usage.input_tokens), output_tokens: tokens(usage.output_tokens) }
}
type Admin = { rpc: (name: string, args: Record<string, unknown>) => any; from: (table: string) => any }
type Context = { req: Request; body: ConciergeRequest; admin: Admin; userId: string | null; tier: Tier }
async function rpc(admin: Admin, name: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await admin.rpc(`concierge_${name}_v1`, args)
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Durable storage unavailable')
  return { ...data, ...(typeof data.state === 'string' ? { state: data.state.toUpperCase() } : {}) }
}
function reply(req: Request, data: any, requestId: string, admissionError = false) {
  const base = { request_id: requestId, durable: true }
  if (data.error) {
    const code = String(data.error)
    const status = code === 'conflict' ? 409 : ['forbidden', 'invalid_token', 'conversation_unavailable'].includes(code) ? 403
      : code === 'quota_exceeded' ? 429 : code === 'request_missing' ? 404
      : code === 'invalid_request' ? 400 : ['gone', 'expired', 'request_expired', 'invalid_state'].includes(code) ? 409 : 503
    return jsonWithCors({ ...base, error: 'This request could not proceed.', code,
      ...(data.terminal === true && ['gone', 'expired', 'request_expired'].includes(code) ? { terminal: true } : {}),
      ...(admissionError && ['quota_exceeded', 'capacity_busy', 'policy_unavailable', 'invalid_request'].includes(code) || (admissionError && code === 'conversation_unavailable' && data.admitted === false) ? { admitted: false } : {}),
      rate_limited: code === 'quota_exceeded' }, { request: req, status })
  }
  if (data.state === 'COMPLETED' && data.response && typeof data.response.message === 'string'
    && data.response.memory_saved === true) return jsonWithCors({ ...data.response, ...base }, { request: req })
  if (['CANCELLED', 'FAILED'].includes(data.state)) return jsonWithCors({ ...base, state: data.state,
    code: 'request_terminal', terminal: true, error: 'This request has ended. You may start a new message.' }, { request: req, status: 409 })
  if (!['RESERVED', 'DISPATCHING', 'UNCERTAIN'].includes(data.state)) throw new Error('Invalid durable result')
  const response = jsonWithCors({ ...base, state: data.state, recovery_required: data.recovery_required === true,
    code: 'request_pending', error: 'This request is still pending. Check its status before sending again.' }, { request: req, status: 202 })
  response.headers.set('Retry-After', '3')
  return response
}
export async function durableStatus({ req, body, admin, userId }: Omit<Context, 'tier'>) {
  if (!body.request_id) return jsonWithCors({ error: 'request_id is required.' }, { request: req, status: 400 })
  try {
    const data = await rpc(admin, 'status', { p_user_id: userId, p_session_id: body.session_id,
      p_request_id: body.request_id, p_payload: durablePayload(body) })
    const canReplay = durableMode() === 'on' && textMaintenance() === 'off'
    if (canReplay && data.error === 'request_missing' && data.recovery_required === true && body.issued_at != null) {
      // Only the database can authorize this: it owns the clock, policy and
      // monotonic purge watermark. Old SQL/old clients fail closed on MISSING.
      // A delayed original still competes for exactly the same immutable key.
      return jsonWithCors({ durable: true, request_id: body.request_id, state: 'MISSING',
        code: 'request_missing', recovery_required: true }, { request: req, status: 202 })
    }
    if (!canReplay) data.recovery_required = false
    return reply(req, data, body.request_id)
  } catch {
    return jsonWithCors({ error: 'Request status is unavailable. Keep this request ID and check again.',
      code: 'status_unavailable', request_id: body.request_id, durable: true }, { request: req, status: 503 })
  }
}
export async function durablePost({ req, body, admin, userId, tier }: Context) {
  // Never mint a new identity/time on behalf of an old caller or recovery.
  if (!body.request_id) return jsonWithCors({ error: 'Update this client before sending durable chat.',
    code: 'request_upgrade_required', admitted: false, durable: true }, { request: req, status: 409 })
  const requestId = body.request_id
  const args = { p_user_id: userId, p_session_id: body.session_id, p_request_id: requestId, p_payload: durablePayload(body) }
  const pending = (code: string) => jsonWithCors({ error: 'Your request may still be pending. Check this same request ID; do not send it as a new request.',
    code, request_id: requestId, durable: true, legacy_request_id: !body.request_id }, { request: req, status: 503 })
  let admission: any
  try { admission = await rpc(admin, 'admit', { ...args, p_tier: tier }) }
  catch {
    // An admission may have committed. Status cannot grant dispatch authority.
    try { return reply(req, await rpc(admin, 'status', args), requestId) } catch { return pending('admission_unknown') }
  }
  if (admission.admitted !== true || admission.error) return reply(req, admission, requestId, true)
  const expectedRequester = userId ? `u:${userId.toLowerCase()}` : `s:${body.session_id}`
  if (admission.state !== 'RESERVED' || admission.requester !== expectedRequester
    || !UUID_PATTERN.test(admission.owner_token ?? '') || !UUID_PATTERN.test(admission.conversation_id ?? '')) return pending('admission_unknown')
  const owned = { p_requester: expectedRequester, p_request_id: requestId, p_owner_token: admission.owner_token }
  let providerReceipt: ReturnType<typeof sanitizedProviderReceipt> | null = null
  const finish = async (outcome: string) => {
    try { return await rpc(admin, 'finish', { ...owned, p_outcome: outcome, p_provider_receipt: providerReceipt }) }
    catch { return null } // No acknowledgement is not proof of terminal storage.
  }
  const terminalReply = async (finished: any) => {
    if (!finished) return null
    if (['FAILED', 'CANCELLED'].includes(finished.state)) return reply(req, finished, requestId)
    if (finished.state === 'COMPLETED') {
      // Finish acknowledges state only, not cache contents. A concurrent commit
      // wins, but only a fresh authorized status read may expose its response.
      try {
        const status = await rpc(admin, 'status', args)
        if (status.state === 'COMPLETED' || status.error) return reply(req, status, requestId)
      } catch { /* keep the original request when the cache cannot be verified */ }
    }
    return null
  }
  let dispatchAttempted = false
  let providerTerminal = false
  try {
    const policy = admission.policy
    if (!policy || !policy.version || Object.entries(DURABLE_LIMITS).some(([key, max]) =>
      !Number.isInteger(policy[key]) || policy[key] <= 0 || policy[key] > max)) throw new Error('Invalid policy')
    const host = getHost(body.host)!
    const canonicalHost = await canonicalConciergeHost(host.id)
    if (!canonicalHost) throw new Error('Canonical context unavailable')
    let events: EventRow[] = []
    let programming = 'Current programming could not be verified. Do not invent dates or availability.'
    try {
      const [features, current] = await Promise.all([getSiteContent().catch(() => []), getUpcomingEvents({ limit: 6 })])
      events = current
      programming = JSON.stringify({ features: features.slice(0,6).map(item => ({ title: item.title, category: item.site_category,
        releaseAt: item.release_at, released: item.released, overview: item.copy_final.slice(0,1200) })), events: events.map(conciergeEventFacts) })
    } catch { /* verified FAQ unavailable; never fabricate */ }
    let answer = verifiedPremiereAnswer(body.message, events)
    if (answer === null) {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('Provider unavailable')
      const prior = await getMemoryContext({ userId, hostAgent: host.id, tier, excludeConversationId: admission.conversation_id })
      const { data: history, error } = await admin.from('host_messages').select('role, content, created_at')
        .eq('conversation_id', admission.conversation_id).in('role', ['user','assistant']).order('created_at', { ascending: false }).limit(30)
      if (error) throw new Error('History unavailable')
      const messages = [...prior, ...chronologicalMessages<{ role: string; content: string; created_at: string }>(history ?? [])].map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      messages.push({ role: 'user', content: body.message })
      const system = `${host.system_prompt}\nCurrent approved GLYPH canonical context (use this for identity facts; it supersedes conflicting legacy descriptions):\n${canonicalHost.context}\nVerified website programming: ${programming}\n${PROGRAMMING_FACT_RULES}\nOnly announce dates and availability from the live programming records. An approved concept preview is not a booked performance or an operating physical venue.`
      // Reject rather than truncate identity/fact rules or the exact user payload.
      if (messages.length > policy.max_input_messages || Buffer.byteLength(JSON.stringify({ system, messages }), 'utf8') > policy.max_prompt_bytes) throw new Error('Prompt envelope exceeded')
      dispatchAttempted = true
      const dispatch = await rpc(admin, 'dispatch', owned)
      if (dispatch.dispatch_granted !== true || dispatch.state !== 'DISPATCHING') return reply(req, dispatch, requestId)
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25000, maxRetries: 0 })
      const completion = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: policy.max_output_tokens, system, messages })
      providerTerminal = true
      providerReceipt = sanitizedProviderReceipt(completion)
      answer = completion.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
      if (!answer) answer = "Sorry, I didn't catch that — try me again?"
    }
    if (answer.length > policy.max_reply_chars) throw new Error('Reply envelope exceeded')
    // Retry only this atomic database transaction, never the paid operation.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completed = await rpc(admin, 'complete', { ...owned, p_user_text: body.message, p_reply: answer, p_provider_terminal: providerTerminal, p_provider_receipt: providerReceipt })
        if (completed.state === 'COMPLETED') return reply(req, completed, requestId)
        // A privacy/deletion or validation error after provider terminality is
        // not proof of terminal ledger state. Reconcile status/finish below.
        if (completed.error && !providerTerminal) return reply(req, completed, requestId)
      } catch { /* response loss and transaction failure are both safely retried */ }
    }
    try {
      const status = await rpc(admin, 'status', args)
      if (status.state === 'COMPLETED') return reply(req, status, requestId)
    } catch { /* keep the uncommitted answer private */ }
    if (dispatchAttempted) {
      const finished = await finish(providerTerminal ? 'provider_terminal_failure' : 'uncertain')
      const response = await terminalReply(finished)
      if (response) return response
    }
    return pending('save_pending')
  } catch {
    // Even a received HTTP error is conservatively unknown unless the provider
    // explicitly proves terminal execution. Never log provider exception text.
    const finished = await finish(!dispatchAttempted ? 'no_dispatch' : providerTerminal ? 'provider_terminal_failure' : 'uncertain')
    if (providerTerminal) {
      const response = await terminalReply(finished)
      if (response) return response
    }
    return pending(dispatchAttempted ? 'dispatch_unknown' : 'preparation_failed')
  }
}
