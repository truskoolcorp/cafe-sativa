import 'server-only'
import {waitUntil} from '@vercel/functions'
import {isContentAdmin} from '@/lib/content/auth'
import {createFiniteNov17TestHandler} from '@/lib/content/character-production-private-test-handler'
import {createCafeFiniteNov17TestOperation} from '@/lib/content/character-production-preparation-server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=90
// No caller scope, authority creation, resets, publication or recurring work.
// New authority and budget require separate approval; code defaults disabled.
const enabled=()=>process.env.CS_CHARACTER_FINITE_NOV17_TEST_ENABLED==='true'&&Date.now()>=Date.parse('2026-11-17T06:00:00Z')&&Date.now()<Date.parse('2026-11-18T06:00:00Z')
export const POST=createFiniteNov17TestHandler({authorize:isContentAdmin,enabled,open:()=>createCafeFiniteNov17TestOperation(enabled),retain:waitUntil})
