import { UUID_PATTERN, validateConciergeRequest } from './request'

export type PendingChatRequest = {
  requester: string
  host: 'laviche' | 'ginger' | 'ahnika'
  body: string
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
const scopeKey = (host: string, requester: string) => `cafe-sativa:pending-chat:${requester}:${host}`
export const sameChatIdentity = (original: string, current: string) => original === current
  || (original.startsWith('guest:') && current.startsWith('guest:'))
const requestKey = (request: PendingChatRequest) => `${scopeKey(request.host, request.requester)}:${JSON.parse(request.body).request_id}`

/** Each request owns an immutable key. Concurrent tabs can retain multiple IDs,
 * but cannot overwrite another request; recover them one at a time per scope.
 * The former scope-only key stays readable for existing pending requests.
 */
export function createPendingChatStorage(getStorage: () => StorageLike) {
  function load(host: PendingChatRequest['host'], requester: string): PendingChatRequest | null {
    let entries: Array<[string, string]> = []
    const scope = scopeKey(host, requester)
    try {
      const storage = getStorage()
      const count = storage.length
      if (count > 4096) throw Object.assign(new Error('Chat storage scan limit exceeded'), { code: 'scan_limit' })
      const names = new Set<string>([scope])
      for (let i = 0; i < count; i++) {
        const name = storage.key(i)
        if (name?.startsWith(`${scope}:`)) names.add(name)
        // Concurrent first tabs may create different anonymous session IDs.
        // Discover their records, but only while viewing anonymous chat.
        if (requester.startsWith('guest:') && name?.startsWith('cafe-sativa:pending-chat:guest:')) {
          const parts = name.split(':')
          if (parts[4] === host) names.add(name)
        }
      }
      for (const name of [...names].sort()) {
        const raw = storage.getItem(name)
        if (raw !== null) entries.push([name, raw])
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'scan_limit') throw error
      throw Object.assign(new Error('Chat storage unavailable'), { code: 'storage_unavailable' })
    }
    const saved = entries.map(([name, raw]) => {
      if (raw.length > 32768) throw new Error('Retained chat record exceeds size limit')
      const request = JSON.parse(raw) as PendingChatRequest
      const body = JSON.parse(request.body)
      if (!validateConciergeRequest(body).valid || request.host !== host || !sameChatIdentity(request.requester, requester) || body.host !== host
        || typeof body.request_id !== 'string' || !UUID_PATTERN.test(body.request_id)
        || typeof body.message !== 'string' || body.surface !== 'web-chat'
        || (request.requester.startsWith('guest:') && (typeof body.session_id !== 'string' || !UUID_PATTERN.test(body.session_id) || request.requester !== `guest:${body.session_id}`))
        || (name !== scopeKey(request.host, request.requester) && name !== requestKey(request))) throw new Error('Invalid retained chat request')
      return request
    })
    return saved[0] ?? null
  }
  return {
    load,
    save(request: PendingChatRequest) {
      const storage = getStorage(), name = requestKey(request)
      if (load(request.host, request.requester)) throw new Error('A chat request is already unresolved')
      // This check is advisory; the unique key, not the scan, prevents tab races.
      if (storage.getItem(name) !== null) throw new Error('Request ID is already retained')
      const value = JSON.stringify(request)
      if (value.length > 32768 || !validateConciergeRequest(JSON.parse(request.body)).valid) throw new Error('Invalid chat request')
      storage.setItem(name, value)
      if (storage.getItem(name) !== value) throw new Error('Chat request could not be retained')
    },
    clear(request: PendingChatRequest) {
      const storage = getStorage()
      for (const name of [requestKey(request), scopeKey(request.host, request.requester)]) {
        const current = storage.getItem(name)
        if (current === null) continue
        const saved = JSON.parse(current) as PendingChatRequest
        // The legacy slot might belong to a different pending request.
        if (saved.body !== request.body || saved.requester !== request.requester || saved.host !== request.host) {
          if (name === requestKey(request)) throw new Error('Retained request changed')
          continue
        }
        storage.removeItem(name)
        if (storage.getItem(name) !== null) throw new Error('Retained request could not be cleared')
      }
    },
  }
}

/** Only explicit safe outcomes release the composer. Unknown failures stay retained. */
export function chatRequestResolved(status: number, data: Record<string, unknown>, recovery = false): boolean {
  if (status === 200 && typeof data.message === 'string' && data.message.trim()) return true
  if (data.terminal === true) return true
  // Neither a status lookup nor a recovery POST rejection fences an older
  // in-flight original. A transient denial creates no rejection tombstone.
  if (recovery) return false
  if (data.admitted === false) return true
  return status === 400 || (status === 429 && data.rate_limited === true)
    || ['origin_not_allowed', 'conversation_unavailable', 'missing_session', 'not_configured'].includes(String(data.code))
}

/** Status never creates work. Only an explicit expired-reservation or missing-request grant allows replay. */
export async function recoverChatRequest(request: PendingChatRequest, fetcher: typeof fetch, signal: AbortSignal,
  stillCurrent: () => boolean) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Concierge-Durable': '1', 'X-Concierge-Requester': request.requester }, body: request.body, signal }
  let response = await fetcher('/api/concierge/status', init)
  let data = await response.json().catch(() => ({}))
  if (stillCurrent() && response.status === 202 && data.recovery_required === true) {
    response = await fetcher('/api/concierge', init)
    data = await response.json().catch(() => ({}))
  }
  // This remains the original recovery chain even after another admission
  // attempt. Only verified terminal state or a committed response may end it.
  return { response, data, recovery: true }
}
