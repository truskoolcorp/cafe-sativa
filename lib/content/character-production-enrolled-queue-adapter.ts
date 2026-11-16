import {productionSlotDigest,type ProductionSlot} from './character-production-engine.ts'
import {restrictProductionRpc,type ExactProductionScope} from './character-production-exact-scope.ts'
import type {ProductionRpc} from './character-production-store.ts'
/** Scoped read routing only. No clients, grants, enrollment or cron instantiated.
 * Database enrollment is authoritative; code allowlist is an additional fence. */
export function createEnrolledProductionRpc(rpc:ProductionRpc,enrollment:string,scopes:readonly ExactProductionScope[]):ProductionRpc{
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(enrollment)||scopes.length<1||scopes.length>32||new Set(scopes.map(s=>s.key)).size!==scopes.length)throw Error('Invalid enrollment scope')
 const exact=new Map(scopes.map(s=>[s.key,{scope:Object.freeze({...s}),rpc:restrictProductionRpc(rpc,s)}]))
 const known=(key:unknown,digest:unknown)=>typeof key==='string'&&exact.get(key)?.scope.digest===digest
 return {async rpc(name,args){
  if(name==='character_production_due'||name==='character_production_pending'){
   const pending=name==='character_production_pending',limit=args.p_limit
   if(Object.keys(args).sort().join()!=='p_limit,p_model,p_provider'||typeof args.p_provider!=='string'||typeof args.p_model!=='string'||!Number.isSafeInteger(limit)||(limit as number)<1||(limit as number)>(pending?5:25))throw Error('Invalid enrolled read')
   const r=await rpc.rpc(pending?'character_production_scheduler_pending':'character_production_scheduler_due',{p_enrollment:enrollment,...args})
   if(r.error)return r
   const rows=pending?r.data:(r.data as {rows?:unknown}|null)?.rows
   if(!Array.isArray(rows)||rows.length>(limit as number)||new Set(rows.map(x=>pending?x?.key:x?.slot?.key)).size!==rows.length)throw Error('Unconfirmed scoped queue')
   for(const row of rows){
    if(pending?!known(row?.key,row?.digest):!known(row?.slot?.key,row?.digest)||productionSlotDigest(row.slot as ProductionSlot)!==row.digest)throw Error('Foreign scoped queue result')
   }
   return r
  }
  const key=(args.p_slot as {key?:unknown}|undefined)?.key??(args.p_job as {key?:unknown}|undefined)?.key??args.p_key
  if(typeof key!=='string'||!exact.has(key))throw Error('Foreign production operation')
  return exact.get(key)!.rpc.rpc(name,args)
 }}
}

/** Actual SDK boundary for this enrollment adapter; old server-RPC whitelist
 * intentionally remains unchanged. No identity/credential/grant fabrication. */
export function createEnrolledServerProductionRpc(
 db:import('./character-production-server-rpc.ts').ProductionServerRpcClient,
 signal:AbortSignal,enrollment:string,scopes:readonly ExactProductionScope[],
):ProductionRpc{
 const allowed=new Set(['scheduler_due','scheduler_pending','authorization','claim','submitted','observe_receipt','unknown','failed','output_status','output','broker_authorized'].map(n=>'character_production_'+n))
 const transport:ProductionRpc={rpc(name,args){
  if(signal.aborted||!allowed.has(name))throw Error('Enrolled SDK scope rejected')
  return db.rpc(name,args).abortSignal(signal).retry(false)
 }}
 return createEnrolledProductionRpc(transport,enrollment,scopes)
}
