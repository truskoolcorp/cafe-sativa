import 'server-only'
import {cronAuthorized} from './auth'
import {createInternalCharacterWorker} from './character-production-internal-worker'
import {openInternalProduction} from './character-production-server-composition'
import {reviewedCanaryManifest,canaryWindowOpen} from './character-production-canary-manifest'

// One finite reviewed private canary; existing flag defaults off and exact durable
// SQL authorization is separately required. No request can supply a manifest.
const manifest=reviewedCanaryManifest()
export const processInternalCharacters=createInternalCharacterWorker({
 enabled:()=>process.env.CS_CHARACTER_INTERNAL_WORKER_ENABLED==='true'&&canaryWindowOpen(),
 authorize:cronAuthorized,
 configuration:manifest.configuration,
 open:(signal,budget)=>{
  if(!canaryWindowOpen())throw Error('Reviewed canary window closed')
  return openInternalProduction(manifest,signal,budget)
 },
})
