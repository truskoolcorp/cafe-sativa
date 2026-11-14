import {productionSlotDigest} from './character-production-engine.ts'
import type {ProductionSlot} from './character-production-engine.ts'
import type {ProductionRpc} from './character-production-store.ts'
export type ExactProductionScope=Readonly<{key:string;digest:string}>
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
/** Additional code-bound one-shot fence. Never grants authority or replaces the
 * database's current slot/budget checks. Unexpected rows hold, never filter them
 * into a misleading successful empty queue. */
export function restrictProductionRpc(rpc:ProductionRpc,scope:ExactProductionScope):ProductionRpc{
 const s=Object.freeze({...scope})
 if(!s.key||s.key.length>240||!/^[a-f0-9]{64}$/.test(s.digest))throw Error('Invalid exact scope')
 const slot=(v:unknown)=>object(v)&&v.key===s.key&&productionSlotDigest(v as ProductionSlot)===s.digest
 const job=(v:unknown)=>object(v)&&v.key===s.key&&v.digest===s.digest
 return {async rpc(name,args){
  const suffix=name.replace(/^character_production_/,'')
  if(name!=='character_production_'+suffix||!['due','pending','authorization','claim','submitted','unknown','failed','output_status','output','broker_authorized'].includes(suffix))throw Error('Out-of-scope RPC')
  if(suffix==='claim'&&(!slot(args.p_slot)||args.p_digest!==s.digest))throw Error('Out-of-scope claim')
  if(['submitted','unknown'].includes(suffix)&&(args.p_key!==s.key||args.p_digest!==s.digest))throw Error('Out-of-scope receipt')
  if(['failed','output_status','output','broker_authorized'].includes(suffix)&&!job(args.p_job))throw Error('Out-of-scope job')
  if(suffix==='authorization'&&args.p_key!==s.key)throw Error('Out-of-scope authorization')
  const r=await rpc.rpc(name,args)
  if(r.error)return r
  if(suffix==='due'&&(!object(r.data)||!Array.isArray(r.data.rows)||r.data.rows.some(v=>!object(v)||v.digest!==s.digest||!slot(v.slot))))throw Error('Out-of-scope queue')
  if(suffix==='pending'&&(!Array.isArray(r.data)||r.data.some(v=>!job(v))))throw Error('Out-of-scope pending tasks')
  if(suffix==='authorization'&&r.data!==null&&(!object(r.data)||r.data.digest!==s.digest||!slot(r.data.slot)))throw Error('Out-of-scope authority')
  return r
 }}
}
