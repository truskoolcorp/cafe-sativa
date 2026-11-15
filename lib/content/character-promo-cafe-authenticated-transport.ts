import 'server-only'
import {cafeScheduleDigest} from './character-promo-cafe-metricool'
import type {CafeSchedule} from './character-promo-cafe-metricool'
import {createClient} from '@/lib/supabase/server'
/** Interactive exact-owner preview only. No worker identity or service-key fallback. */
const OWNER='54b71f3f-19e1-46f0-99e2-28993463caf8'
export function createCafeAuthenticatedOwnerTransport(config:{signal:AbortSignal;previewDigest:string;previewPlanId:string}){
 if(!/^[a-f0-9]{64}$/.test(config.previewDigest)||!/^[a-f0-9-]{36}$/.test(config.previewPlanId))throw Error('Exact owner preview digest required')
 const digest=config.previewDigest,planId=config.previewPlanId,signal=AbortSignal.any([config.signal,AbortSignal.timeout(15000)])
 signal.throwIfAborted()
 const client=createClient()
 let attempted=false
 const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{
  signal.throwIfAborted()
  let cancel:()=>void=()=>{}
  const aborted=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true})})
  try{const result=await Promise.race([Promise.resolve().then(operation),aborted]);signal.throwIfAborted();return result}
  finally{signal.removeEventListener('abort',cancel)}
 }
 const auth=async()=>{
  signal.throwIfAborted()
  const {data:{user},error}=await bounded(()=>client.auth.getUser())
  signal.throwIfAborted()
  if(error||!user||user.id!==OWNER||user.app_metadata?.cafe_sativa_admin!==true)return null
  return {id:user.id,isContentAdmin:true as const}
 }
 return {
 auth,
 /** Dedicated explicit owner-preview operation, not the standing-policy RPC
  * callback. No adapter may silently reinterpret a policy record as consent. */
 async recordConfirmedPreview(args:Record<string,unknown>,submission:{confirmed:true;previewDigest:string},callSignal:AbortSignal){
  signal.throwIfAborted();callSignal.throwIfAborted()
  if(attempted||submission?.confirmed!==true||submission.previewDigest!==digest)throw Error('Fresh explicit owner submission required')
  const keys=['p_plan','p_snapshot','p_digest','p_destination','p_media','p_source','p_expires_at']
  if(Object.keys(args).length!==keys.length||keys.some(k=>!Object.hasOwn(args,k))||args.p_digest!==digest||args.p_plan!==planId)throw Error('Unreviewed owner authority request')
  const copy=JSON.parse(JSON.stringify(args)) as Record<string,unknown>
  if(!copy.p_snapshot||typeof copy.p_snapshot!=='object'||Array.isArray(copy.p_snapshot)||(copy.p_snapshot as Record<string,unknown>).planId!==planId||cafeScheduleDigest(copy.p_snapshot as CafeSchedule)!==digest)throw Error('Owner preview snapshot changed')
  const actor=await auth();callSignal.throwIfAborted()
  if(!actor)throw Error('Current exact owner required')
  const request={p_plan:planId,p_snapshot:copy.p_snapshot,p_digest:digest,p_destination:copy.p_destination,p_media:copy.p_media,p_source:copy.p_source,p_expires_at:copy.p_expires_at}
  signal.throwIfAborted();callSignal.throwIfAborted()
  // SQL derives actor and current approval timestamp; never sends caller policy
  // evidence or fabricated owner-message references. No retry on uncertainty.
  if(attempted)throw Error('Owner preview already attempted; reconcile only')
  attempted=true
  const result=await client.rpc('cs_record_authenticated_cafe_authority',request).abortSignal(AbortSignal.any([signal,callSignal]))
  signal.throwIfAborted();callSignal.throwIfAborted()
  return {data:result.data,error:result.error}
 }
 }
}
