import 'server-only'
import {waitUntil} from '@vercel/functions'
import {isContentAdmin} from '@/lib/content/auth'
import {openReplenishmentSources} from '@/lib/content/character-production-replenishment-sources-server'
import {createPrivateDiagnostics,PRIVATE_SOURCE_SCOPE} from '@/lib/content/character-production-private-diagnostics'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=90
export const GET=createPrivateDiagnostics({authorize:isContentAdmin,open:signal=>openReplenishmentSources(PRIVATE_SOURCE_SCOPE,signal),retain:waitUntil})
