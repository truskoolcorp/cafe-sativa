import type {CafeApprovalCandidate} from './character-promo-cafe-approval'
import {validateCafeApprovalCandidate} from './character-promo-cafe-approval'
import {cafeScheduleDigest} from './character-promo-cafe-metricool'
import {matchesCafeSemanticReview,type CafeSemanticInput} from './character-promo-cafe-semantic-review'
import type {CafeScopeAssessment} from './character-promo-cafe-owner-policy'
/** Exact private scoped RPC only. SQL derives stored owner/policy/enrollment and
 * performs source CAS/revocation checks. This interface never opens a raw writer. */
export function createEnrolledCafeAuthorityTransport(d:{
 load(planId:string,signal:AbortSignal):Promise<CafeApprovalCandidate>
 assess(input:CafeSemanticInput,signal:AbortSignal):Promise<CafeScopeAssessment|null>
 rpc(name:'cs_record_enrolled_cafe_authority',args:Record<string,unknown>,signal:AbortSignal):Promise<{data:unknown;error:unknown}>
}){
 let attempted=false,busy=false
 return {async record(planId:string,expectedDigest:string,signal:AbortSignal){
  if(attempted||busy||signal.aborted)return {status:'held' as const}
  if(!/^[a-f0-9-]{36}$/.test(planId)||! /^[a-f0-9]{64}$/.test(expectedDigest))return {status:'held' as const}
  busy=true
  const life=new AbortController(),safety=AbortSignal.any([signal,life.signal,AbortSignal.timeout(55000)])
  const bounded=async<T>(work:()=>Promise<T>):Promise<T>=>{let abort:()=>void=()=>{};try{safety.throwIfAborted();return await Promise.race([Promise.resolve().then(()=>{safety.throwIfAborted();return work()}),new Promise<never>((_,reject)=>{abort=()=>reject(Error('Aborted'));safety.addEventListener('abort',abort,{once:true});if(safety.aborted)abort()})])}finally{safety.removeEventListener('abort',abort)}}
  signal=safety
  try{
   const raw=await bounded(()=>d.load(planId,signal));signal.throwIfAborted()
   const candidate={...structuredClone({...raw,sources:{...raw.sources,videoBytes:undefined}}),sources:{...structuredClone({...raw.sources,videoBytes:undefined}),videoBytes:Uint8Array.from(raw.sources.videoBytes)}} as CafeApprovalCandidate
   validateCafeApprovalCandidate(candidate,Date.now());const s=candidate.schedule,digest=cafeScheduleDigest(s)
   if(s.planId!==planId||digest!==expectedDigest)return {status:'held' as const}
   const input:CafeSemanticInput={scheduleDigest:digest,contentEvidenceDigest:s.contentApprovalDigest,script:candidate.sources.draft.spoken_script,visualBrief:candidate.sources.draft.visual_brief,caption:s.caption,title:s.facebookTitle??'',hashtags:[...s.hashtags],collaborators:s.collaborators.map(c=>c.handle)}
   const assessment=await bounded(()=>d.assess(input,signal));signal.throwIfAborted()
   if(!assessment||!matchesCafeSemanticReview(assessment,input))return {status:'held' as const}
   validateCafeApprovalCandidate(candidate,Date.now());signal.throwIfAborted()
   attempted=true
   const r=await bounded(()=>d.rpc('cs_record_enrolled_cafe_authority',{p_plan:planId,p_snapshot:s,p_digest:digest,p_source:candidate.sourceState,p_assessment:assessment},signal))
   signal.throwIfAborted()
   const v=r.data as {digest?:unknown;expiresAt?:unknown}|null
   if(r.error||v?.digest!==digest||typeof v.expiresAt!=='string'||!Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.expiresAt)<=Date.now())return {status:'unconfirmed' as const}
   return {status:'recorded' as const,digest,expiresAt:v.expiresAt,published:false,scheduled:false}
  }catch{return {status:attempted?'unconfirmed' as const:'held' as const}}finally{life.abort();busy=false}
 }}
}
