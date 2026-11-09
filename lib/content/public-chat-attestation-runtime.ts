import 'server-only'
import { createFixedServerReadiness } from './public-chat-readiness-server'
import { parsePrivateReadinessConfig } from './public-chat-readiness-config'

// One process-local immutable binding. Missing/malformed private configuration is
// disabled. Read only this noncredential variable; construction performs no I/O.
// Never provision it without separate review/authorization. Redeploy to change/revoke.
const readiness = createFixedServerReadiness(parsePrivateReadinessConfig(process.env.CAFE_PRIVATE_CHAT_READINESS_JSON))
export function publicChatReadiness(signal?: AbortSignal) {
  return readiness(signal)
}

