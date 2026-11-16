import { UUID_PATTERN } from './request'

const SESSION_KEY = 'cafe-sativa:session-id'
const CONVERSATION_PREFIX = 'cafe-sativa:conv-id:'

/** Storage can be blocked in private browsing. Keep this page usable without it. */
export function createChatStorage(getStorage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, createId: () => string) {
  const fallback = new Map<string, string>()
  const read = (key: string): string | null => {
    if (fallback.has(key)) return fallback.get(key)!
    try {
      const value = getStorage().getItem(key)
      if (value !== null) fallback.set(key, value)
      return value
    } catch { return null }
  }
  const write = (key: string, value: string) => {
    fallback.set(key, value)
    try { getStorage().setItem(key, value) } catch { /* page-local continuity */ }
  }
  const key = (host: string, requester: string) => `${CONVERSATION_PREFIX}${requester}:${host}`
  return {
    sessionId() {
      const stored = read(SESSION_KEY)
      if (stored && UUID_PATTERN.test(stored)) return stored
      const id = createId()
      write(SESSION_KEY, id)
      return id
    },
    conversationId(host: string, requester: string) {
      const stored = read(key(host, requester))
      return stored && UUID_PATTERN.test(stored) ? stored : null
    },
    saveConversation(host: string, requester: string, id: string) {
      if (UUID_PATTERN.test(id)) write(key(host, requester), id)
    },
    clearConversation(host: string, requester: string) {
      // Empty sentinel also masks inaccessible or failed-to-remove storage.
      fallback.set(key(host, requester), '')
      try { getStorage().removeItem(key(host, requester)) } catch { /* page-local removal */ }
    },
  }
}
