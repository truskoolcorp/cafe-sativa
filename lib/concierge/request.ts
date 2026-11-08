export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Bind the replay lifetime to the key itself, so pruning a tombstone cannot
 * make the same UUID fresh again just by changing a timestamp in the body. */
export function durableRequestIssuedAt(requestId: string): number | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return null
  return Number.parseInt(requestId.slice(0, 8) + requestId.slice(9, 13), 16)
}

export function createDurableRequestIdentity(now = Date.now(), randomId = crypto.randomUUID()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff || !UUID_PATTERN.test(randomId)) throw new Error('Request identity unavailable')
  const timestamp = now.toString(16).padStart(12, '0')
  // randomUUID supplies cryptographically secure randomness; retain 74 random bits.
  const request_id = `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${randomId.slice(15, 18)}-${((Number.parseInt(randomId[19], 16) & 3) | 8).toString(16)}${randomId.slice(20)}`.toLowerCase()
  if (durableRequestIssuedAt(request_id) !== now) throw new Error('Request identity unavailable')
  return { request_id, issued_at: now }
}

export type ConciergeRequest = {
  request_id?: string | null
  issued_at?: number | null
  host: 'laviche' | 'ginger' | 'ahnika'
  message: string
  session_id: string | null
  conversation_id: string | null
  surface: 'web-chat' | 'mall-3d' | 'email'
  room_id: string | null
}

export function validateConciergeRequest(value: unknown):
  { valid: true; body: ConciergeRequest } | { valid: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, error: 'Invalid chat request.' }
  const body = value as Record<string, unknown>
  if (typeof body.message !== 'string' || !body.message.trim()) return { valid: false, error: 'Message is required.' }
  if (body.message.length > 2000) return { valid: false, error: 'Message is too long. Keep it under 2000 characters.' }
  if (typeof body.host !== 'string' || !['laviche', 'ginger', 'ahnika'].includes(body.host)) return { valid: false, error: 'Unknown host. Expected one of: laviche, ginger, ahnika.' }
  if (typeof body.surface !== 'string' || !['web-chat', 'mall-3d', 'email'].includes(body.surface)) return { valid: false, error: 'surface must be one of: web-chat, mall-3d, email.' }
  // The persisted session_id is text. External callers are not all proven
  // to use UUIDs, so preserve bounded opaque legacy identifiers and trimming.
  if (body.session_id != null && (typeof body.session_id !== 'string' || !body.session_id.trim()
    || body.session_id.length > 256 || /[\u0000-\u001f\u007f]/.test(body.session_id))) {
    return { valid: false, error: 'Invalid session_id. Use a nonempty text identifier up to 256 characters.' }
  }
  if (body.request_id != null && (typeof body.request_id !== 'string' || !UUID_PATTERN.test(body.request_id))) return { valid: false, error: 'Invalid request_id. Expected a UUID.' }
  if (body.issued_at != null && (typeof body.issued_at !== 'number' || !Number.isSafeInteger(body.issued_at)
    || body.issued_at < 0 || typeof body.request_id !== 'string' || durableRequestIssuedAt(body.request_id) !== body.issued_at)) {
    return { valid: false, error: 'Invalid issued_at. Expected immutable epoch milliseconds matching the request UUIDv7.' }
  }
  if (body.conversation_id != null && (typeof body.conversation_id !== 'string' || !UUID_PATTERN.test(body.conversation_id))) {
    return { valid: false, error: 'Invalid conversation_id. Expected a UUID.' }
  }
  if (body.room_id != null && (typeof body.room_id !== 'string' || !body.room_id.trim()
    || body.room_id.length > 128 || /[\u0000-\u001f\u007f]/.test(body.room_id))) {
    return { valid: false, error: 'Invalid room_id.' }
  }
  return { valid: true, body: {
    issued_at: typeof body.issued_at === 'number' ? body.issued_at : null,
    request_id: typeof body.request_id === 'string' ? body.request_id.toLowerCase() : null,
    host: body.host as ConciergeRequest['host'], message: body.message.trim(),
    session_id: typeof body.session_id === 'string' ? body.session_id.trim() : null,
    conversation_id: body.conversation_id as string ?? null,
    surface: body.surface as ConciergeRequest['surface'], room_id: body.room_id as string ?? null,
  } }
}

/** Modern mode headers require a well-formed expectation before auth or I/O. */
export function conciergeRequesterValid(req: Request): boolean {
  const expected = req.headers.get('x-concierge-requester')
  if (expected === null) return req.headers.get('x-concierge-durable') === null
  if (/^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected)) return true
  if (!expected.startsWith('guest:')) return false
  const session = expected.slice(6)
  return session.length > 0 && session.length <= 256 && session === session.trim()
    && !/[\u0000-\u001f\u007f]/.test(session)
}

/** A browser expectation is only a fence; verified auth still selects identity. */
export function conciergeRequesterMatches(req: Request, userId: string | null, sessionId: string | null): boolean {
  const expected = req.headers.get('x-concierge-requester')
  if (expected === null) return req.headers.get('x-concierge-durable') === null
  return expected === (userId ? `user:${userId}` : `guest:${sessionId}`)
}
