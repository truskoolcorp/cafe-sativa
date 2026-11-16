import 'server-only'
import {join} from 'node:path'
import {createSelectedTechnicalQa} from './character-production-selected-technical-qa'
import type {SelectedItem} from './character-production-selected-session'
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
export function openPrivateQaSession(signal:AbortSignal,dispatchGuard?:()=>void){
  const network=createProductionFetch(signal,(input,init)=>{signal.throwIfAborted();dispatchGuard?.();const path=new URL(input instanceof Request?input.url:String(input)).pathname;if(/^\/rest\/v1\/rpc\/character_production_technical_qa_(claim|record|receipt)$/.test(path)&&(process.env.CS_CHARACTER_TECHNICAL_RECEIPTS_ENABLED!=='true'||process.env.CS_CHARACTER_TECHNICAL_QA_ENABLED!=='true'))throw Error('Technical receipt native dispatch disabled');return fetch(input,init)}),db=createAdminClient(network.fetch)
  const allowed=new Set(['character_production_qa_ready_slots','character_production_qa_materialize','character_production_qa_prepare','character_production_qa_commit','character_production_technical_qa_claim','character_production_technical_qa_record','character_production_technical_qa_receipt'])
  const rpc:ProductionRpc={async rpc(name,args){
   if(signal.aborted||!allowed.has(name)||(name.startsWith('character_production_technical_qa_')&&process.env.CS_CHARACTER_TECHNICAL_RECEIPTS_ENABLED!=='true'))throw Error('QA RPC scope rejected')
   return db.rpc(name,args).abortSignal(signal).retry(false)
  }}
  const storage=createStreamingQaStorage(db.storage,15000)
  const bridge=createCharacterProductionQaBridge(rpc,storage)
  let technical:ReturnType<typeof createSelectedTechnicalQa>|undefined
  return {rpc,async evaluateSelected(item:SelectedItem,selectorRpc:ProductionRpc){
   if(process.env.CS_CHARACTER_TECHNICAL_QA_ENABLED!=='true')throw Error('Technical QA disabled')
   const origin=process.env.NEXT_PUBLIC_SUPABASE_URL
   if(!origin)throw Error('Private storage origin missing')
   technical=createSelectedTechnicalQa({rpc:{rpc:(name,args)=>name==='character_production_selected_binding'?selectorRpc.rpc(name,args):rpc.rpc(name,args)},storage:db.storage,signal,persistTechnical:process.env.CS_CHARACTER_TECHNICAL_RECEIPTS_ENABLED==='true',enabled:()=>process.env.CS_CHARACTER_TECHNICAL_QA_ENABLED==='true',origin,ffmpeg:join(process.cwd(),'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),ffprobe:join(process.cwd(),'node_modules/@ffprobe-installer/linux-x64/ffprobe')})
   return technical.run(item)
  },async whenSettled(){const settled=await Promise.allSettled([technical?.whenSettled(),network.whenSettled()]);if(settled.some(r=>r.status==='rejected'))throw Error('QA original transport settlement failed')},bridge:{async ingest(key:string,digest:string){
   if(signal.aborted)throw Error('QA cancelled')
   const bucket=await db.storage.getBucket('cafe-sativa-content')
   if(bucket.error)throw Error('QA destination unavailable')
   assertOriginalQaDestination(bucket.data)
   return bridge.ingest(key,digest)
  }}}
}
export const processPrivateQa=createPrivateQaWorker({
 enabled:()=>process.env.CS_CHARACTER_QA_BRIDGE_ENABLED==='true',authorize:cronAuthorized,
 open:openPrivateQaSession,
})

