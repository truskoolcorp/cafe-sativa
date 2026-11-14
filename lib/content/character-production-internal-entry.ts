import 'server-only'
import {cronAuthorized} from './auth'
import {createInternalCharacterWorker} from './character-production-internal-worker'
import {openInternalProduction} from './character-production-server-composition'
import type {InternalProductionManifest} from './character-production-server-composition'

// Intentionally empty until exact input receipts and finite DB authorization are
// reviewed together. No enable flag or incoming request can replace this manifest.
function reviewedManifest():InternalProductionManifest|null{return null}
const manifest=reviewedManifest()
/** Intentionally unconfigured. Do not infer canonical IDs, substitute voices or
 * turn environment flags into spending authorization. Existing CRON_SECRET stays
 * in the existing platform cron path; there is no new upload endpoint or secret. */
export const processInternalCharacters=createInternalCharacterWorker({
 enabled:()=>process.env.CS_CHARACTER_INTERNAL_WORKER_ENABLED==='true',
 authorize:cronAuthorized,
 configuration:manifest?.configuration??null,
 open:signal=>{
  if(!manifest)throw Error('Reviewed provider, canonical and private storage bindings required')
  return openInternalProduction(manifest,signal)
 },
})
