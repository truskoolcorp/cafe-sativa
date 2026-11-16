import 'server-only'
import {createHash} from 'node:crypto'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {cafeBoundedReadFetch} from './character-promo-cafe-read-fetch'
import {cafeEditorialFromPlan} from './character-promo-cafe-editorial-from-plan'
import {createCafeSourceReader} from './character-promo-cafe-sources-server'
import {validateCafeApprovalCandidate} from './character-promo-cafe-approval'
import {cafeScheduleDigest,dispatchCafeMetricool,type CafeCollaborator} from './character-promo-cafe-metricool'
import {createCafeMetricoolStore,createCafeMetricoolAuthority,type CafeStoreRpc} from './character-promo-cafe-store'
import {openCharacterPromoDispatchSession} from './character-promo-dispatch-connection'
import {readCharacterPromoProviderMedia} from './character-promo-metricool'
import {metricoolSession} from './metricool-mcp'
import {unseal} from './metricool-oauth'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
/** Only a trusted stored selector supplies planId. No HTTP identity, owner
 * override, authority creation, retry, credential refresh or implicit RPC client. */
export function createCafeDispatchOperation(planId:string,capability:ProductionServerRpcClient|null,verified:readonly CafeCollaborator[],upstreamEnabled:()=>boolean=()=>true){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(planId))throw Error('Exact plan required')
 const collaborators=structuredClone(verified),enabled=()=>upstreamEnabled()&&process.env.CS_CAFE_ENROLLED_DISPATCH_ENABLED==='true'
 let used=false,closing=false,work:Promise<unknown>|undefined,network:ReturnType<typeof createProductionFetch>|undefined,source:ReturnType<typeof createCafeSourceReader>|undefined
 return {async run(parent:AbortSignal){
  if(used||closing||parent.aborted||!enabled()||!capability)return {status:'disabled' as const}
  used=true
  const signal=AbortSignal.any([parent,AbortSignal.timeout(55000)])
  const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Dispatch disabled')}
  work=(async()=>{
   check()
   const raw=await capability.rpc('cs_cafe_initial_editorial',{p_plan:planId}).abortSignal(signal).retry(false);check()
   const row=raw.data as {planId:string;plan:Record<string,unknown>;draft:Record<string,unknown>}|null
   if(raw.error||!row||row.planId!==planId||row.plan?.id!==planId||!row.draft)throw Error('Exact stored editorial unavailable')
   const metadata=new Map([[planId,cafeEditorialFromPlan(row.plan,row.draft,row,collaborators)]])
   source=createCafeSourceReader({signal,metadata,verifiedCollaborators:collaborators})
   const candidate=await source.load(planId);check();validateCafeApprovalCandidate(candidate,Date.now())
   const schedule=candidate.schedule,digest=cafeScheduleDigest(schedule)
   if(schedule.planId!==planId)throw Error('Stored plan changed')
   network=createProductionFetch(signal,(input,init)=>{check();return fetch(input,init)})
   const db=createAdminClient(cafeBoundedReadFetch(network.fetch)),storage=createAdminClient(network.fetch)
   const rpc:CafeStoreRpc=async(name,args)=>{
    check();const result=await capability.rpc(name,args).abortSignal(signal).retry(false);check();return result
   }
   const verify=async()=>{check();const fresh=await source!.load(planId);check();validateCafeApprovalCandidate(fresh,Date.now());if(cafeScheduleDigest(fresh.schedule)!==digest)throw Error('Current source changed')}
   const authorize=createCafeMetricoolAuthority(rpc,async(s,d)=>{if(s.planId!==planId||d!==digest||cafeScheduleDigest(s)!==digest)throw Error('Foreign dispatch');await verify()})
   const storageOrigin=process.env.NEXT_PUBLIC_SUPABASE_URL||''
   const origin=new URL(storageOrigin)
   if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.username||origin.password)throw Error('Invalid media origin')
   return await dispatchCafeMetricool(schedule,{
    now:Date.now,storageOrigin,verifiedCollaborators:collaborators,authorize,
    store:createCafeMetricoolStore(schedule,rpc),
    async media(s){
     await authorize(s,digest)
     if(s.videoPath!==schedule.videoPath||s.videoSha256!==schedule.videoSha256)throw Error('Foreign media')
     const signed=await storage.storage.from('cafe-sativa-content').createSignedUrl(s.videoPath,3600);check()
     if(signed.error||!signed.data?.signedUrl)throw Error('Private media unavailable')
     return {url:signed.data.signedUrl,sha256:s.videoSha256}
    },
    async verifyHostedMedia(url,sha){
     check();const bytes=await readCharacterPromoProviderMedia(url,network!.fetch);check()
     if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('Hosted media changed')
    },
    async openSession(){
     check();const session=await openCharacterPromoDispatchSession({db,now:Date.now,decrypt:v=>unseal(v,'credentials'),openSession:token=>metricoolSession(token,signal,network!.fetch)});check()
     return {async call(name,args){check();const result=await session.call(name,args);check();return result}}
    },
   },{enabled:true})
  })()
  return await work
 },async whenSettled(){
  closing=true
  const results=await Promise.allSettled(work?[work]:[])
  await Promise.allSettled([...(source?[source.whenSettled()]:[]),...(network?[network.whenSettled()]:[])])
  if(results.some(r=>r.status==='rejected'))throw Error('Dispatch settled with failure')
 }}
}
