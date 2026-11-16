import 'server-only'
import {waitUntil} from '@vercel/functions'
import {isContentAdmin} from '@/lib/content/auth'
import {createPrivateTestHandler,PRIVATE_TEST_EXPIRES_AT} from '@/lib/content/character-production-private-test-handler'
import {createCafePrivateTextRecoveryOperation} from '@/lib/content/character-production-preparation-server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=90
// Additive one-use recovery requires separately approved ledger authority.
const enabled=()=>process.env.CS_CHARACTER_PRIVATE_TEST_ENABLED==='true'&&Date.now()<PRIVATE_TEST_EXPIRES_AT&&process.env.CS_CHARACTER_PRIVATE_TEXT_RECOVERY_ENABLED==='true'
export const POST=createPrivateTestHandler({authorize:isContentAdmin,enabled,
 open:()=>createCafePrivateTextRecoveryOperation(enabled),retain:waitUntil})
