import 'server-only'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
/** One finite atomic preparation, no publishing/authority grant or paid inference.
 * Exact draft comes from trusted enrolled QA selection, never request body. */
export function createCafeFirstDeliveryOperation(draftId:string,capability:ProductionServerRpcClient|null){
 let used=false,work:Promise<unknown>|null=null
 const enabled=()=>process.env.CS_CAFE_FIRST_DELIVERY_ENABLED==='true'
 return {run(signal:AbortSignal){
  if(used||!enabled()||!capability||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(draftId))return Promise.resolve({status:'disabled' as const})
  used=true
  const s=AbortSignal.any([signal,AbortSignal.timeout(55000)])
  const check=()=>{s.throwIfAborted();if(!enabled())throw Error('First delivery held')}
  const promise=(async()=>{
   check();const r=await capability.rpc('cs_prepare_cafe_delivery_plans',{p_draft:draftId}).abortSignal(s).retry(false);check()
   if(r.error)throw Error('Initial plan outcome unknown')
   if(r.data===null)return {status:'held' as const}
   const x=r.data as {draftId:string;facebookPlanId:string;instagramPlanId:string;scheduledAt:string;created:boolean}
   const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v)
   if(Object.keys(x).sort().join(',')!==['draftId','facebookPlanId','instagramPlanId','scheduledAt','created'].sort().join(',')||x.draftId!==draftId||!uuid(x.facebookPlanId)||!uuid(x.instagramPlanId)||x.facebookPlanId===x.instagramPlanId||typeof x.created!=='boolean'||!Number.isFinite(Date.parse(x.scheduledAt))||Date.parse(x.scheduledAt)<=Date.now())throw Error('Initial plan receipt unconfirmed')
   const rows=[]
   for(const [planId,network,accountId] of [[x.facebookPlanId,'facebook','105363501666032'],[x.instagramPlanId,'instagram','cafesativainc']]){
    check();const read=await capability.rpc('cs_cafe_initial_editorial',{p_plan:planId}).abortSignal(s).retry(false);check()
    const data=read.data as {planId:string;draftId:string;network:string;accountId:string;scheduledAt:string}
    if(read.error||!data||data.planId!==planId||data.draftId!==draftId||data.network!==network||data.accountId!==accountId||Date.parse(data.scheduledAt)!==Date.parse(x.scheduledAt))throw Error('Initial editorial receipt unconfirmed')
    rows.push(structuredClone(read.data))
   }
   return {status:'plans_prepared' as const,receipt:structuredClone(x),editorial:rows,published:false as const}
  })();work=promise;return promise
 },async whenSettled(){used=true;await work}}
}
