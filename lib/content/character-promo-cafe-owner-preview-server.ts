import 'server-only'
import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {cafeBoundedReadFetch} from './character-promo-cafe-read-fetch'
import {createCafeSourceReader} from './character-promo-cafe-sources-server'
import {cafeEditorialFromPlan} from './character-promo-cafe-editorial-from-plan'
import {validateCafeApprovalCandidate} from './character-promo-cafe-approval'
import {cafeScheduleDigest,cafeReservationKeys} from './character-promo-cafe-metricool'
import {createCafeAuthenticatedOwnerTransport} from './character-promo-cafe-authenticated-transport'
const OWNER='54b71f3f-19e1-46f0-99e2-28993463caf8'
const ORIGIN='https://www.cafe-sativa.com'
/** Finite reviewed plan allowlist. Populate only after a genuine new plan and QA
 * exist; never reuse external-receipt drafts or synthetic fixture identifiers. */
export const CAFE_OWNER_PREVIEW_SCOPE:{enabled:boolean;planIds:readonly string[];expiresAt:number|null}=Object.freeze({enabled:false,planIds:Object.freeze([] as string[]),expiresAt:null})
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}
const response=(body:unknown,status=200)=>Response.json(body,{status,headers})
async function bounded<T>(signal:AbortSignal,call:()=>Promise<T>):Promise<T>{
 signal.throwIfAborted();let cancel:()=>void=()=>{}
 const aborted=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true})})
 try{const result=await Promise.race([Promise.resolve().then(()=>{signal.throwIfAborted();return call()}),aborted]);signal.throwIfAborted();return result}finally{signal.removeEventListener('abort',cancel)}
}
async function readBody(req:Request,signal:AbortSignal){
 if(!req.body)throw Error('Confirmation body required')
 const reader=req.body.getReader();let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true})
 try{while(true){const chunk=await bounded(signal,()=>reader.read());if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>512)throw Error('Body too large');text+=decoder.decode(chunk.value,{stream:true})}text+=decoder.decode();return JSON.parse(text)}finally{void reader.cancel().catch(()=>{})}
}
/** Fixed route only. GET never records authority; POST receives confirmation and
 * digest, never a source snapshot, metadata, QA, actor or policy. */
export async function cafeOwnerPreviewRequest(req:Request){
 const scope={...CAFE_OWNER_PREVIEW_SCOPE,planIds:[...CAFE_OWNER_PREVIEW_SCOPE.planIds]},now=Date.now()
 if(!scope.enabled||!scope.expiresAt||scope.expiresAt<=now||scope.planIds.length===0)return response({status:'disabled',reason:'No reviewed finite ready-plan scope is configured.'},503)
 if(req.method!=='GET'&&req.method!=='POST')return response({error:'Method not allowed'},405)
 const url=new URL(req.url)
 if(url.origin!==ORIGIN)return response({error:'Untrusted origin'},403)
 if(req.method==='POST'&&(req.headers.get('origin')!==ORIGIN||req.headers.get('sec-fetch-site')!=='same-origin'||req.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||url.search))return response({error:'Same-origin confirmation required'},403)
 const controller=new AbortController(),signal=AbortSignal.any([req.signal,controller.signal,AbortSignal.timeout(55000)])
 let source:ReturnType<typeof createCafeSourceReader>|undefined
 const network=createProductionFetch(signal)
 try{
  const authClient=createClient(),auth=await bounded(signal,()=>authClient.auth.getUser())
  if(auth.error||auth.data.user?.id!==OWNER||auth.data.user.app_metadata?.cafe_sativa_admin!==true)return response({error:'Current exact owner required'},401)
  let planId:string,expectedDigest:string|undefined
  if(req.method==='GET'){
   if(Array.from(url.searchParams.keys()).length!==1||!url.searchParams.has('planId'))return response({error:'Exact configured plan required'},400)
   planId=url.searchParams.get('planId')||''
  }else{
   const body=await readBody(req,signal)
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='confirm,digest,planId'||body.confirm!==true||typeof body.digest!=='string'||!/^[a-f0-9]{64}$/.test(body.digest))return response({error:'Explicit exact preview confirmation required'},400)
   planId=body.planId;expectedDigest=body.digest
  }
  if(typeof planId!=='string'||!scope.planIds.includes(planId))return response({error:'Plan is outside reviewed finite scope'},403)
  const db=createAdminClient(cafeBoundedReadFetch(network.fetch))
  const pr=await bounded(signal,()=>Promise.resolve(db.from('cs_character_promo_delivery_plans').select('*').eq('id',planId).limit(2).abortSignal(signal).retry(false)))
  if(pr.error||!Array.isArray(pr.data)||pr.data.length!==1)throw Error('Existing delivery plan unavailable')
  const dr=await bounded(signal,()=>Promise.resolve(db.from('cs_character_promo_drafts').select('*').eq('id',pr.data[0].promo_id).limit(2).abortSignal(signal).retry(false)))
  if(dr.error||!Array.isArray(dr.data)||dr.data.length!==1)throw Error('Existing promotion unavailable')
  const metadata=cafeEditorialFromPlan(pr.data[0],dr.data[0])
  source=createCafeSourceReader({signal,metadata:new Map([[planId,metadata]]),verifiedCollaborators:[]})
  const candidate=await bounded(signal,()=>source!.load(planId))
  validateCafeApprovalCandidate(candidate,Date.now())
  const digest=cafeScheduleDigest(candidate.schedule)
  if(req.method==='GET')return response({status:'preview',planId,digest,submissionWindowEnds:new Date(scope.expiresAt).toISOString(),schedule:candidate.schedule,qaVerified:true,recorded:false,published:false})
  if(expectedDigest!==digest)return response({error:'Preview changed; review the current preview again'},409)
  const expiry=Math.min(scope.expiresAt,Date.now()+15*60000,Date.parse(candidate.schedule.scheduledAt)-60000)
  if(expiry<=Date.now())return response({error:'Finite approval window expired'},409)
  const transport=createCafeAuthenticatedOwnerTransport({signal,previewPlanId:planId,previewDigest:digest}),keys=cafeReservationKeys(candidate.schedule)
  const result=await bounded(signal,()=>transport.recordConfirmedPreview({p_plan:planId,p_snapshot:candidate.schedule,p_digest:digest,p_destination:keys.destinationTimeKey,p_media:keys.mediaDestinationKey,p_source:candidate.sourceState,p_expires_at:new Date(expiry).toISOString()},{confirmed:true,previewDigest:digest},signal))
  if(result.error||!result.data||result.data.digest!==digest||result.data.expiresAt!==new Date(expiry).toISOString())return response({status:'unconfirmed',error:'Do not resubmit; reconcile the existing approval read-only.'},503)
  return response({status:'recorded',planId,digest,approvalExpiresAt:result.data.expiresAt,published:false,scheduled:false})
 }catch{return response({status:'not_ready_or_unconfirmed',error:'Readiness or approval could not be verified. No automatic retry. Check existing records before submitting again.'},503)}
 finally{controller.abort();if(source)void source.whenSettled().catch(()=>{});void network.whenSettled().catch(()=>{})}
}
