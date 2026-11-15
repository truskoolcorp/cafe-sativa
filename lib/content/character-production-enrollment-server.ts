import 'server-only'
import {cronAuthorized} from './auth'
import {snapshotProductionManifest} from './character-production-manifest-snapshot'
import {createAdminClient} from '@/lib/supabase/admin'
import {productionSlotDigest} from './character-production-engine'
import {createInternalScopedPlannerEntry} from './character-production-planner-entry-server'
import type {ReviewedPlannerEnrollment} from './character-production-planner-entry'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
import {openInternalProduction,type InternalProductionManifest} from './character-production-server-composition'
import {createInternalCharacterWorker} from './character-production-internal-worker'
import {createEnrolledServerProductionRpc} from './character-production-enrolled-queue-adapter'
import {createEnrolledQaEntry} from './character-production-enrolled-qa-entry'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createStreamingQaStorage} from './character-production-qa-storage'
/** Dormant factory: caller owns reviewed enrollment/capability, no default, route or cron.
 * Three independent bounded phases; no inline chained provider/publication work.
 * Existing durable enrollment/slot/budget controls remain authoritative. */
export function createInternalEnrollmentRuntime(enrollment:ReviewedPlannerEnrollment,manifest:InternalProductionManifest,
 openPlanner:(signal:AbortSignal)=>ProductionServerRpcClient|null){
 const reviewed=structuredClone(enrollment)
 const scopes=reviewed.manifest.candidates.map(c=>Object.freeze({key:c.slot.key,digest:productionSlotDigest(c.slot)}))
 if(!scopes.length||scopes.length>32||new Set(scopes.map(s=>s.key)).size!==scopes.length||manifest.exactScope)throw Error('Invalid enrollment runtime')
 if(reviewed.manifest.candidates.some(c=>c.slot.provider!==manifest.configuration.engine.provider||c.slot.model!==manifest.configuration.engine.model))throw Error('Provider scope mismatch')
 const workerManifest=snapshotProductionManifest(manifest)
 return {
  planner:createInternalScopedPlannerEntry(reviewed,openPlanner),
  worker:createInternalCharacterWorker({enabled:()=>process.env.CS_CHARACTER_ENROLLED_WORKER_ENABLED==='true',authorize:cronAuthorized,
   configuration:workerManifest.configuration,
   open:(signal,budget)=>openInternalProduction(workerManifest,signal,budget,(db,s)=>createEnrolledServerProductionRpc(db,s,reviewed.id,scopes))}),
  qa:createEnrolledQaEntry(reviewed.id,scopes,{enabled:()=>process.env.CS_CHARACTER_ENROLLED_QA_ENABLED==='true',authorize:cronAuthorized,
   open:signal=>{
    const network=createProductionFetch(signal),db=createAdminClient(network.fetch)
    return {db,storage:createStreamingQaStorage(db.storage,8000),whenSettled:()=>network.whenSettled()}
   }}),
 }
}
