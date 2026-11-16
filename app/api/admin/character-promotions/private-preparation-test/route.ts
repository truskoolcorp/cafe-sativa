import 'server-only'
import {waitUntil} from '@vercel/functions'
import {isContentAdmin} from '@/lib/content/auth'
import {createPrivateTestHandler,PRIVATE_TEST_EXPIRES_AT} from '@/lib/content/character-production-private-test-handler'
import {createCafePreparationOperation} from '@/lib/content/character-production-preparation-server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=90
// Deploying this adapter alone cannot activate or provision any authority.
const enabled=()=>process.env.CS_CHARACTER_PRIVATE_TEST_ENABLED==='true'&&Date.now()<PRIVATE_TEST_EXPIRES_AT
export const POST=createPrivateTestHandler({authorize:isContentAdmin,enabled,
 open:()=>createCafePreparationOperation(enabled),retain:waitUntil})
