import type {ProductionServerRpcClient} from './character-production-server-rpc.ts'
import type {ProductionRpc} from './character-production-store.ts'
import type {ExactProductionScope} from './character-production-exact-scope.ts'
/** No authentication claims: caller supplies authenticated reviewed capability.
 * Discovery is not human QA approval; bridge only ingests private unapproved MP4. */
export function createEnrolledQaRpc(db:ProductionServerRpcClient,signal:AbortSignal,enrollment:string,scopes:readonly ExactProductionScope[]):ProductionRpc{
 if(!/^[a-f0-9-]{36}$/i.test(enrollment)||scopes.length<1||scopes.length>32||new Set(scopes.map(s=>s.key)).size!==scopes.length||scopes.some(s=>!s.key||!/^[a-f0-9]{64}$/.test(s.digest)))throw Error('Invalid QA scope')
 const known=new Map(scopes.map(s=>[s.key,s.digest]))
 return {async rpc(name,args){
  if(signal.aborted)throw Error('Cancelled')
  let target=name,parameters=args
  if(name==='character_production_qa_ready_slots'){
   if(Object.keys(args).join()!=='p_limit'||!Number.isSafeInteger(args.p_limit)||(args.p_limit as number)<1||(args.p_limit as number)>5)throw Error('Invalid QA discovery')
   target='character_production_scheduler_qa_ready';parameters={p_enrollment:enrollment,p_limit:args.p_limit}
  }else if(!['character_production_qa_materialize','character_production_qa_prepare','character_production_qa_commit'].includes(name)||typeof args.p_key!=='string'||!known.has(args.p_key)||known.get(args.p_key)!==args.p_digest)throw Error('Foreign QA operation')
  const r=await db.rpc(target,parameters).abortSignal(signal).retry(false)
  if(signal.aborted)throw Error('Cancelled')
  if(r.error)return r
  if(name==='character_production_qa_ready_slots'){
   if(!Array.isArray(r.data)||r.data.length>(args.p_limit as number)||new Set(r.data.map(x=>x?.key)).size!==r.data.length||r.data.some(x=>!x||Object.keys(x).sort().join()!=='digest,key'||!known.has(x.key)||known.get(x.key)!==x.digest))throw Error('Unconfirmed QA discovery')
  }
  return r
 }}
}
