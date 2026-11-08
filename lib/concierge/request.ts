export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ConciergeRequest = {
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
  if (body.conversation_id != null && (typeof body.conversation_id !== 'string' || !UUID_PATTERN.test(body.conversation_id))) {
    return { valid: false, error: 'Invalid conversation_id. Expected a UUID.' }
  }
  if (body.room_id != null && (typeof body.room_id !== 'string' || !body.room_id.trim()
    || body.room_id.length > 128 || /[\u0000-\u001f\u007f]/.test(body.room_id))) {
    return { valid: false, error: 'Invalid room_id.' }
  }
  return { valid: true, body: {
    host: body.host as ConciergeRequest['host'], message: body.message.trim(),
    session_id: typeof body.session_id === 'string' ? body.session_id.trim() : null,
    conversation_id: body.conversation_id as string ?? null,
    surface: body.surface as ConciergeRequest['surface'], room_id: body.room_id as string ?? null,
  } }
}
