import 'server-only'
import {createCafeRecurringEntry,type CafeRecurringPhase,type CafeRecurringSession} from './character-production-recurring-entry'
import {createCafeInitialStandingOperation} from './character-promo-cafe-initial-standing-server'
import type {CafeStandingServerConfig} from './character-promo-cafe-standing-server'
import {createCafeDispatchOperation} from './character-promo-cafe-dispatch-server'
import {createCafePublicationReconciliationOperation} from './character-production-publication-reconcile-server'
type Selected={phase:'authority';draftId:string}|{phase:'dispatch'|'reconcile';planId:string}
/** The supplied capability is a reviewed narrowly authenticated server opener,
 * never request JSON or an implicit admin RPC fallback. No activation here. */
export function createCafePublicationRuntime(input:Omit<CafeStandingServerConfig,'signal'|'metadata'>&{
 authorize(header:string|null):boolean
 whenCapabilitySettled():Promise<void>
}){
 const config={capability:input.capability,semanticLease:input.semanticLease?structuredClone(input.semanticLease):null,verifiedCollaborators:structuredClone(input.verifiedCollaborators),authorize:input.authorize,whenCapabilitySettled:input.whenCapabilitySettled}
 const enabled=()=>process.env.CS_CAFE_PUBLICATION_RUNTIME_ENABLED==='true'
 return createCafeRecurringEntry({enabled,authorize:config.authorize,open(signal):CafeRecurringSession{
  let selected:Selected|null=null,used=false,pending:Promise<unknown>|null=null,operation:{whenSettled():Promise<void>}|null=null
  const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Publication runtime held')}
  return {async next(){
   if(used||!config.capability)throw Error('Trusted publication capability unavailable')
   used=true;check()
   pending=(async()=>{const r=await config.capability!.rpc('cs_cafe_publication_next',{}).abortSignal(signal).retry(false);check()
    if(r.error)throw Error('Publication selector unavailable')
    if(r.data===null)return null
    const v=r.data as Record<string,unknown>,uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
    if(v.phase==='held')throw Error('Original submission requires reconciliation')
    const key=v.phase==='authority'?'draftId':'planId'
    if(!['authority','dispatch','reconcile'].includes(String(v.phase))||Object.keys(v).sort().join(',')!==[key,'phase'].sort().join(',')||!uuid(v[key]))throw Error('Exact stored selection unavailable')
    selected=structuredClone(v) as unknown as Selected
    return selected.phase
   })()
   return await pending as CafeRecurringPhase|null
  },stages:{
   async authority(){
    check();if(selected?.phase!=='authority')throw Error('Foreign phase')
    const op=createCafeInitialStandingOperation(selected.draftId,{...config,signal});operation=op
    pending=op.run();const r=await pending as {status:string};check()
    if(r.status!=='authority_recorded')throw Error('Authority held')
   },
   async dispatch(){
    check();if(selected?.phase!=='dispatch')throw Error('Foreign phase')
    const op=createCafeDispatchOperation(selected.planId,config.capability,config.verifiedCollaborators,enabled);operation=op
    pending=op.run(signal);const r=await pending as {status:string};check()
    if(r.status!=='scheduled')throw Error('Dispatch held; never retry unknown')
   },
   async reconcile(){
    check();if(selected?.phase!=='reconcile')throw Error('Foreign phase')
    const op=createCafePublicationReconciliationOperation(selected.planId,config.capability);operation=op
    pending=op.run(signal);await pending;check()
    // Pending/error provider states are observations, never publication proof.
   },
  },async whenSettled(){
   await Promise.allSettled(pending?[pending]:[])
   const drains=await Promise.allSettled([...(operation?[operation.whenSettled()]:[]),config.whenCapabilitySettled()])
   if(drains.some(x=>x.status==='rejected'))throw Error('Publication drain unconfirmed')
  }}
 }})
}
