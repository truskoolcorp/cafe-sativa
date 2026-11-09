import 'server-only'
import { createFixedServerReadiness } from './public-chat-readiness-server'

// One process-local instance, deliberately disabled by literal null approval.
// Construction performs no environment/credential reads or network I/O.
// Activation requires separately reviewed server-only approval; no env toggle.
const readiness = createFixedServerReadiness(null)
export function publicChatReadiness(signal?: AbortSignal) {
  return readiness(signal)
}
