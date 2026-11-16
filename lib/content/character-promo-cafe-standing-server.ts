import 'server-only'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
import type {CafeEditorialMetadata} from './character-promo-cafe-sources'
import type {CafeCollaborator} from './character-promo-cafe-metricool'
import {createCafeSourceReader} from './character-promo-cafe-sources-server'
import {createCafeSemanticBudgetAdapter} from './character-promo-cafe-semantic-budget-adapter'
import {createCafeSemanticReviewer,type CafeSemanticBudgetTransport} from './character-promo-cafe-semantic-server'
import {createEnrolledCafeAuthorityTransport} from './character-promo-cafe-enrolled-authority'

/** Trusted server-only composition; never construct from request JSON. The
 * supplied client requires separately reviewed scoped capabilities. It must
 * not be an implicit owner credential or raw writer fallback. No client is
 * created here, and default construction performs no network/provider I/O. */
export type CafeStandingServerConfig={
 signal:AbortSignal
 metadata:ReadonlyMap<string,CafeEditorialMetadata>
 verifiedCollaborators:readonly CafeCollaborator[]
 capability:ProductionServerRpcClient|null
 /** Separately approved semantic spend, never HeyGen's $20 allowance. */
 semanticLease:CafeSemanticBudgetTransport['lease']
}
export function createCafeStandingServer(config:CafeStandingServerConfig){
 // Snapshot trusted metadata/lease before any asynchronous work. Source rows,
 // current policy, QA and account mapping are still verified on each attempt.
 const metadata=new Map(Array.from(config.metadata,([k,v])=>[k,structuredClone(v)]))
 const verifiedCollaborators=structuredClone(config.verifiedCollaborators)
 const ownerSignal=config.signal
 const authorityWork=new Set<Promise<unknown>>()
 const capability=config.capability,lease=config.semanticLease?structuredClone(config.semanticLease):null
 let busy=false,consumed=false
 return {async record(input:{planId:string;expectedDigest:string},options:{enabled?:boolean}={}){
  if(options.enabled!==true)return {status:'disabled' as const}
  if(busy||consumed||ownerSignal.aborted||!capability||!lease||lease.countingAuthorized!==true||lease.expiresAt<=Date.now())return {status:'held' as const}
  // One composition instance is one finite attempt. Durable uniqueness remains
  // in SQL across instances; failures do not unlock a paid inference retry.
  consumed=true;busy=true
  const life=new AbortController(),signal=AbortSignal.any([ownerSignal,life.signal,AbortSignal.timeout(55000)])
  let source:ReturnType<typeof createCafeSourceReader>|undefined,assess:ReturnType<typeof createCafeSemanticReviewer>|undefined
  try{
   assess=createCafeSemanticReviewer(createCafeSemanticBudgetAdapter(capability,lease))
   const transport=createEnrolledCafeAuthorityTransport({
    load:async(planId,s)=>{s.throwIfAborted();source??=createCafeSourceReader({signal:s,metadata,verifiedCollaborators});return source.load(planId)},
    assess,
    rpc:async(name,args,s)=>{s.throwIfAborted();const work=Promise.resolve(capability.rpc(name,args).abortSignal(s).retry(false));authorityWork.add(work);try{return await work}finally{authorityWork.delete(work)}},
   })
   return await transport.record(input.planId,input.expectedDigest,signal)
  }catch{return {status:'held' as const}}finally{
   life.abort()
   // Admission remains occupied until original inference/backend/media work has
   // really settled; cancellation or a raced timeout is not settlement.
   try{const settled=await Promise.allSettled([assess?.whenSettled(),source?.whenSettled(),...authorityWork]);if(settled.some(r=>r.status==='rejected'))throw Error('Standing work settlement failed')}finally{busy=false}
  }
 }}
}
