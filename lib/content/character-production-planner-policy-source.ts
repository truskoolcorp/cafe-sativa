import type {ProductionServerRpcClient} from './character-production-server-rpc.ts'
import type {PlanningPolicy} from './character-production-planner-validation.ts'
const keys=['id','revision','enabled','expiresAt','ownerEvidenceRef','characters','themes','capCents','accountId']
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
const exact=(x:Record<string,unknown>,k:string[])=>Object.keys(x).sort().join('|')===[...k].sort().join('|')
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
const tags=(x:unknown):x is string[]=>Array.isArray(x)&&x.length>=1&&x.length<=20&&x.every(t=>typeof t==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/.test(t))
/** Read-only exact RPC. No fallback to request-provided policy or broad table query.
 * Invoke only through a restricted trusted server client, never a browser client.
 * The enclosing validator supplies its finite deadline via signal.
 */
export function createPlannerPolicySource(db:ProductionServerRpcClient,now:()=>number){
 return async(id:string,signal:AbortSignal):Promise<PlanningPolicy|null>=>{
  if(signal.aborted||!uuid(id))return null
  const start=now()
  try{
   const r=await db.rpc('character_production_planning_policy',{p_id:id}).abortSignal(signal).retry(false),end=now()
   if(signal.aborted||r.error||end<start||!object(r.data)||!exact(r.data,['policy','observedAt']))return null
   const observed=r.data.observedAt,p=r.data.policy
   if(typeof observed!=='number'||!Number.isSafeInteger(observed)||observed<start||observed>end||!object(p)||!exact(p,keys))return null
   if(p.id!==id||!Number.isSafeInteger(p.revision)||(p.revision as number)<1||p.enabled!==true||!Number.isSafeInteger(p.expiresAt)||(p.expiresAt as number)<=end||typeof p.ownerEvidenceRef!=='string'||!p.ownerEvidenceRef.trim()||p.ownerEvidenceRef.length>500||!tags(p.characters)||!tags(p.themes)||!Number.isSafeInteger(p.capCents)||(p.capCents as number)<1||(p.capCents as number)>2000||p.accountId!=='d61468fdf18c4b478f27857337ddd1ea')return null
   return Object.freeze({...p,characters:Object.freeze([...p.characters]),themes:Object.freeze([...p.themes])}) as PlanningPolicy
  }catch{return null}
 }
}
