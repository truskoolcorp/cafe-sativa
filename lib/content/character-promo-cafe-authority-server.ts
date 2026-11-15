import 'server-only'
import {createCafeSourceReader} from './character-promo-cafe-sources-server'
import type {CafeEditorialMetadata} from './character-promo-cafe-sources'
import type {CafeCollaborator} from './character-promo-cafe-metricool'
import {createCafeOwnerPolicyResolver} from './character-promo-cafe-owner-policy'
import type {CafeOwnerPolicy,CafeScopeAssessment} from './character-promo-cafe-owner-policy'
import {recordCafeScheduleAuthority,createCafeApprovalPersistence} from './character-promo-cafe-approval'
import type {CafeApprovalWriterDeps} from './character-promo-cafe-approval'

/** No route or activation. Callbacks are trusted server dependencies, never
 * request JSON. An actor UUID is not authentication; auth must resolve the
 * actual current authenticated content-admin session. No scheduler identity
 * or implicit service_role grant is supplied by this composition. */
export type CafeAuthorityServerConfig={
 signal:AbortSignal
 metadata:ReadonlyMap<string,CafeEditorialMetadata>
 verifiedCollaborators:readonly CafeCollaborator[]
 auth(signal:AbortSignal):ReturnType<CafeApprovalWriterDeps['auth']>
 readPolicy(signal:AbortSignal):Promise<CafeOwnerPolicy|null>
 assessScope(digest:string,signal:AbortSignal):Promise<CafeScopeAssessment|null>
 /** Separately reviewed narrow capability; abort-aware, retry(false), no
  * implicit createAdminClient RPC fallback or credential copying. */
 authorityRpc(name:'cs_record_cafe_metricool_authority',args:Record<string,unknown>,signal:AbortSignal):Promise<{data:unknown;error:unknown}>
}

/** Composes existing source, policy and authority writer only. Provider-free
 * means no provider mutation: source verification still reads live canon and
 * account mapping. A recorded authority is NOT scheduled or published. */
export function createCafeAuthorityServer(config:CafeAuthorityServerConfig){
 return {
 async record(input:{planId:string;expectedDigest:string},options:{enabled?:boolean}={}){
  if(options.enabled!==true)return {status:'disabled' as const}
  if(!config.signal||typeof config.auth!=='function'||typeof config.readPolicy!=='function'||typeof config.assessScope!=='function'||typeof config.authorityRpc!=='function')throw Error('Trusted Café authority dependencies missing')
  const {auth,readPolicy,assessScope,authorityRpc}=config
  const controller=new AbortController(),signal=AbortSignal.any([config.signal,controller.signal,AbortSignal.timeout(55000)])
  const snapshot=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T
  const metadata=new Map(Array.from(config.metadata,([key,value])=>[key,snapshot(value)]))
  const verifiedCollaborators=snapshot(config.verifiedCollaborators)
  let source:ReturnType<typeof createCafeSourceReader>|undefined
  // Racing abort bounds non-cooperative callbacks; post-await checks prevent
  // a late authentication/policy result from advancing to a write.
  const bounded=async<T>(call:()=>Promise<T>):Promise<T>=>{
   signal.throwIfAborted()
   let cancel:()=>void=()=>{}
   const aborted=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true})})
   try{const result=await Promise.race([Promise.resolve().then(()=>{signal.throwIfAborted();return call()}),aborted]);signal.throwIfAborted();return result}
   finally{signal.removeEventListener('abort',cancel)}
  }
  try{
   const ownerAuthority=createCafeOwnerPolicyResolver({now:Date.now,verifiedCollaborators,readPolicy:()=>bounded(()=>readPolicy(signal)),assessScope:digest=>bounded(()=>assessScope(digest,signal))})
   return await recordCafeScheduleAuthority({...input},{
    now:Date.now,
    auth:()=>bounded(()=>auth(signal)),
    load:planId=>bounded(()=>{source??=createCafeSourceReader({signal,metadata,verifiedCollaborators});return source.load(planId)}),
    ownerAuthority,
    persist:createCafeApprovalPersistence((name,args)=>bounded(()=>authorityRpc(name,args,signal))),
   },{enabled:true})
  }finally{
   controller.abort()
   // Existing production source network owns bounded requests; initiate drain
   // after cancellation without allowing cleanup to reopen or retry anything.
   if(source)void source.whenSettled().catch(()=>{})
  }
 }
 }
}
