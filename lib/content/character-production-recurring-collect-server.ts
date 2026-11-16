import type {createSelectedProductionSession} from './character-production-selected-session'
import 'server-only'
import {openInternalProduction,type InternalProductionManifest} from './character-production-server-composition'
import {createBrokeredCharacterProductionRuntime} from './character-production-runtime'
import {createBrokeredProductionStore,createPrivateOutputBroker} from './character-production-scoped'
import {createPrivateOutputStorage} from './character-production-broker-boundary'
import type {ProductionRpc} from './character-production-store'
import type {CafeRecurringSession} from './character-production-recurring-entry'

/** Collection of ORIGINAL task IDs only. No manifest is instantiated here and
 * no route/cron or permission is added. A newly reviewed live composition must
 * supply its manifest; the expired canary must never be silently reused.
 * Read-only provider polling may persist private bytes/receipts, but cannot
 * reserve a generation claim, submit a new task, plan, approve or publish. */
export function createRecurringCollectionSession(signal:AbortSignal,manifest:InternalProductionManifest,selection?:Pick<ReturnType<typeof createSelectedProductionSession>,'readCollect'>):CafeRecurringSession {
 let opened:ReturnType<typeof openInternalProduction>|undefined
 let collect:(()=>Promise<{status:string;held:number}>)|undefined
 let read=false,selected=false,used=false
 const enabled=()=>process.env.CS_CHARACTER_INTERNAL_WORKER_ENABLED==='true'&&manifest.configuration.engine.enabled===true&&manifest.configuration.heygen.enabled===true
 const check=(callSignal:AbortSignal)=>{signal.throwIfAborted();callSignal.throwIfAborted();if(callSignal!==signal||!enabled())throw Error('Collection unavailable')}
 return {
  async next(callSignal){
   check(callSignal);if(read)throw Error('Selection already consumed');read=true
   // No paid-dispatch budget: the existing transport rejects submission without
   // one. The collector RPC allowlist independently rejects generation claims.
   opened=openInternalProduction(manifest,signal)
   const backend=opened,allowed=new Set(['character_production_pending','character_production_failed','character_production_broker_authorized','character_production_output_status','character_production_output'])
   const rpc:ProductionRpc={async rpc(name,args){check(signal);if(!allowed.has(name))throw Error('Collection RPC rejected');const result=name==='character_production_pending'&&selection?{data:await selection.readCollect(),error:null}:await backend.rpc.rpc(name,args);check(signal);return result}}
   const cfg=manifest.configuration
   const broker=createPrivateOutputBroker({rpc,storage:createPrivateOutputStorage(backend.storage,8000),authorize:async job=>{
    const result=await rpc.rpc('character_production_broker_authorized',{p_job:job});return !result.error&&result.data===true
   }},{provider:cfg.engine.provider,model:cfg.engine.model,maxBytes:cfg.engine.maxVideoBytes})
   const store=createBrokeredProductionStore(rpc,broker)
   const engine=createBrokeredCharacterProductionRuntime(cfg,()=>({...backend,rpc,outputBroker:broker}))
   const pending=await store.pending(cfg.engine.provider,cfg.engine.model,1)
   check(signal);selected=pending.length===1
   collect=()=>engine.collect(1)
   return selected?'collect':null
  },
  stages:{async collect(callSignal){
   check(callSignal);if(!selected||used||!collect)throw Error('Collection not selected');used=true
   // The real engine re-reads original pending task IDs and validates media and
   // receipt identities. Another worker's completion can make this safely idle.
   const result=await collect();check(signal)
   if(result.status!=='collected'||result.held!==0)throw Error('Original collection held')
  }},
  async whenSettled(){await opened?.whenSettled()},
 }
}
