import type {createSelectedProductionSession} from './character-production-selected-session'
import 'server-only'
import {openInternalProduction,type InternalProductionManifest} from './character-production-server-composition'
import {createBrokeredCharacterProductionRuntime} from './character-production-runtime'
import {createProductionQueue,type ScheduledProductionSlot} from './character-production-coordinator'
import type {ProductionTimeBudget} from './character-production-time-budget'
import {cafeHeyGenPeriod} from './character-production-heygen-budget'
import type {ProductionRpc} from './character-production-store'
import type {CafeRecurringSession} from './character-production-recurring-entry'

/** Dormant generation adapter, not authorization or enrollment. Requires a
 * separately reviewed current manifest and the real exact authorized SQL queue.
 * No collect/QA/publication chaining, caller candidate or old canary default. */
export function createRecurringGenerationSession(signal:AbortSignal,manifest:InternalProductionManifest,budget:ProductionTimeBudget,selection?:Pick<ReturnType<typeof createSelectedProductionSession>,'readDue'>):CafeRecurringSession {
 let opened:ReturnType<typeof openInternalProduction>|undefined
 let selected:ScheduledProductionSlot|undefined,read=false,used=false
 let produce:(()=>Promise<void>)|undefined
 const cfg=manifest.configuration
 const enabled=()=>process.env.CS_CHARACTER_INTERNAL_WORKER_ENABLED==='true'&&cfg.engine.enabled===true&&cfg.heygen.enabled===true
 const check=(s:AbortSignal)=>{signal.throwIfAborted();s.throwIfAborted();if(s!==signal||!enabled())throw Error('Generation unavailable')}
 const timely=(r:ScheduledProductionSlot)=>{const now=cfg.engine.now();return Number.isSafeInteger(now)&&now>=r.scheduledAt&&now<r.notAfter&&r.slot.period===cafeHeyGenPeriod(now)&&r.slot.periodCapCents<=2000}
 return {
  async next(s){
   check(s);if(read||cfg.engine.provider!=='heygen'||cfg.engine.captureReceipts!==true)throw Error('Generation selection unavailable');read=true
   opened=openInternalProduction(manifest,signal,{requireRemaining(ms){
    check(signal);if(!selected||!timely(selected))throw Error('Generation authorization expired before dispatch')
    budget.requireRemaining(ms)
   }})
   const backend=opened
   const allowed=new Set(['character_production_due','character_production_pending','character_production_authorization','character_production_claim','character_production_observe_receipt','character_production_submitted','character_production_unknown'])
   const rpc:ProductionRpc={async rpc(name,args){check(signal);if(!allowed.has(name))throw Error('Generation RPC rejected');const result=await backend.rpc.rpc(name,args);check(signal);return result}}
   const queue=createProductionQueue(rpc,cfg.engine.now)
   const due=()=>selection?selection.readDue():queue.due(cfg.engine.provider,cfg.engine.model,1)
   // Generation cannot persist private video or impersonate collection receipts.
   const engine=createBrokeredCharacterProductionRuntime(cfg,()=>({...backend,rpc,outputBroker:{async save(){throw Error('Generation cannot collect output')}}}))
   const pending=async()=>{const r=await rpc.rpc('character_production_pending',{p_provider:cfg.engine.provider,p_model:cfg.engine.model,p_limit:1});if(r.error||!Array.isArray(r.data)||r.data.length>1)throw Error('Original task state unknown');return r.data.length>0}
   if(await pending())return null
   const rows=await due();check(signal)
   if(!rows.length||!timely(rows[0]))return null
   selected=rows[0]
   produce=async()=>{
    if(await pending())throw Error('Collect original task first')
    const current=await due();check(signal)
    if(!selected||current.length!==1||current[0].slot.key!==selected.slot.key||current[0].digest!==selected.digest||!timely(current[0]))throw Error('Exact due candidate changed')
    // Real runtime verifies current canon/provider/authority and SQL atomically
    // reserves the unique key and monthly spend. Never retries an unknown write.
    const result=await engine.produce(current[0].slot);check(signal)
    if(result.status!=='submitted')throw Error('Generation held')
   }
   return 'generate'
  },
  stages:{async generate(s){check(s);if(!selected||used||!produce)throw Error('Generation not selected');used=true;await produce()}},
  async whenSettled(){await opened?.whenSettled()},
 }
}
