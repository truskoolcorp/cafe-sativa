import type {ProductionRpc} from './character-production-store.ts'

const keyPattern=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/,digestPattern=/^[a-f0-9]{64}$/
type Identity={key:string;digest:string}
function identities(value:unknown,limit:number):Identity[]{
 if(!Array.isArray(value)||value.length>limit)throw Error('Invalid recurring QA queue')
 const seen=new Set<string>()
 return value.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='digest,key'||
   typeof row.key!=='string'||!keyPattern.test(row.key)||typeof row.digest!=='string'||!digestPattern.test(row.digest)||seen.has(row.key))throw Error('Invalid recurring QA identity')
  seen.add(row.key);return Object.freeze({key:row.key,digest:row.digest})
 })
}
/** Dormant post-collection stage. No provider, claim, budget, approval or publish
 * dependency exists here. The caller must use abort-aware bounded RPC/storage
 * transports and retain admission until their original operations settle.
 * SQL, not caller input, binds exact approved slots to precreated blank drafts.
 * This local guard is not a distributed lock; target CAS/storage insertion are. */
export function createRecurringPrivateQa(d:{
 enabled():boolean;
 open(signal:AbortSignal):{
  rpc:ProductionRpc;
  bridge:{ingest(key:string,digest:string):Promise<{status:'ingested'|'held'}>};
  whenSettled():Promise<void>;
 };
 limit?:number;
}){
 const limit=d.limit??1
 if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('Invalid recurring QA limit')
 let running=false
 return {async run(signal:AbortSignal){
  if(!d.enabled())return {status:'disabled' as const,checked:0,ingested:0,held:0}
  if(signal.aborted)return {status:'cancelled' as const,checked:0,ingested:0,held:0}
  if(running)return {status:'busy' as const,checked:0,ingested:0,held:0}
  running=true
  let dependencies:ReturnType<typeof d.open>|undefined
  let checked=0,ingested=0,held=0
  try{
   dependencies=d.open(signal)
   const result=await dependencies.rpc.rpc('character_production_qa_ready_slots',{p_limit:limit})
   if(result.error)throw Error('Recurring QA queue unavailable')
   const rows=identities(result.data,limit)
   for(const row of rows){
    if(signal.aborted)break
    checked++
    try{
     const bound=await dependencies.rpc.rpc('character_production_qa_materialize',{p_key:row.key,p_digest:row.digest})
     if(bound.error||bound.data!==true||signal.aborted){held++;continue}
     const copied=await dependencies.bridge.ingest(row.key,row.digest)
     if(copied.status==='ingested')ingested++;else held++
    }catch{held++}
   }
   return {status:signal.aborted?'cancelled' as const:'checked' as const,checked,ingested,held}
  }finally{
   try{await dependencies?.whenSettled()}finally{running=false}
  }
 }}
}
