import 'server-only'
import {cronAuthorized} from './auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createCharacterProductionQaBridge} from './character-production-qa-bridge'
import {createStreamingQaStorage} from './character-production-qa-storage'
import {createPrivateQaWorker} from './character-production-qa-worker'
import {assertOriginalQaDestination} from './character-production-original-qa'
import type {ProductionRpc} from './character-production-store'

// No manifest, binding rows or scheduler are created by this route. Missing
// reviewed runtime grants/configuration holds; a flag alone cannot enroll jobs.
export const processPrivateQa=createPrivateQaWorker({
 enabled:()=>process.env.CS_CHARACTER_QA_BRIDGE_ENABLED==='true',authorize:cronAuthorized,
 open(signal){
  const network=createProductionFetch(signal),db=createAdminClient(network.fetch)
  const allowed=new Set(['character_production_qa_ready_slots','character_production_qa_materialize','character_production_qa_prepare','character_production_qa_commit'])
  const rpc:ProductionRpc={async rpc(name,args){
   if(signal.aborted||!allowed.has(name))throw Error('QA RPC scope rejected')
   return db.rpc(name,args).abortSignal(signal).retry(false)
  }}
  const storage=createStreamingQaStorage(db.storage,15000)
  const bridge=createCharacterProductionQaBridge(rpc,storage)
  return {rpc,whenSettled:network.whenSettled,bridge:{async ingest(key,digest){
   if(signal.aborted)throw Error('QA cancelled')
   const bucket=await db.storage.getBucket('cafe-sativa-content')
   if(bucket.error)throw Error('QA destination unavailable')
   assertOriginalQaDestination(bucket.data)
   return bridge.ingest(key,digest)
  }}}
 },
})
