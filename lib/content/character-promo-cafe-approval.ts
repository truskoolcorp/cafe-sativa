import {createHash} from 'node:crypto'
import type {PromoSources} from './character-promo-delivery'
import {cafeScheduleDigest,cafeReservationKeys,validateCafeSchedule} from './character-promo-cafe-metricool'
import type {CafeSchedule,CafeCollaborator} from './character-promo-cafe-metricool'
import {normalizePromoDatabaseTime} from './character-promo-time'
import {assertNoKnownExternalPromo} from './character-promo-known-external'

/** Dormant authority writer; never exposed to request bodies or dispatches.
 * An authenticated server admin may record an existing owner authorization.
 * QA observations are NOT publication permission; no owner-click requirement is
 * added when an independently verified prior authorization covers this digest. */
export const CAFE_AUTHORITY_WRITER_ENABLED=false
const checks=['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark'] as const
const knownMarked=new Set(['a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d','ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7','70f2ad3fe14420e472908850576b3240bbad2a3e6d121ae2f89a7da77148f4e0'])
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex')
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const hash=(v:string)=>/^[a-f0-9]{64}$/.test(v)
function demand(v:unknown,message:string):asserts v {if(!v)throw Error(message)}
const dated=(v:string|null,now:number)=>!!v&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now
const fresh=(v:string,now:number)=>dated(v,now)&&now-Date.parse(v)<=60000
export type CafeOwnerAuthority={
 /** Opaque reference to verified owner-authored permission, never secret/URL. */
 reference:string; evidenceRecord?:string; scheduleDigest:string; authorizedAt:string; expiresAt:string; revoked:boolean
}
export type CafeApprovalCandidate={schedule:CafeSchedule;sources:PromoSources;sourceState:unknown;verifiedCollaborators:readonly CafeCollaborator[]}
/** Same content-only digest used to prepare a candidate; no approval is inferred. */
export function cafeContentEvidenceDigest(s:PromoSources){
 return sha(stable({draft:s.draft,plan:s.plan,qa:[...s.qa].sort((a,b)=>a.id.localeCompare(b.id)),canon:{...s.canon,checked_at:undefined},videoSha256:sha(s.videoBytes)}))
}
function validate(candidate:CafeApprovalCandidate,now:number){
 const {schedule:s,sources:v}=candidate,{draft:d,plan:p,canon:c,connection:x}=v
 demand(Number.isFinite(now),'Invalid clock')
 validateCafeSchedule(s,candidate.verifiedCollaborators,now);assertNoKnownExternalPromo(s)
 demand(uuid(s.planId)&&uuid(s.promoId)&&p.id===s.planId&&d.id===s.promoId&&p.promo_id===d.id&&p.character_id===d.character_id&&s.characterId===d.character_id,'Exact source identity required')
 demand(d.status==='script_approved'&&p.status==='ready_for_delivery'&&d.actual_social_account==='metricool-brand:7605217','Source not cleared')
 demand(p.caption===s.caption&&normalizePromoDatabaseTime(p.scheduled_at,true)===s.scheduledAt&&p.network===s.network&&p.account_id===s.accountId,'Plan metadata changed')
 demand(d.spoken_script.trim()&&d.visual_brief.trim()&&dated(d.updated_at,now),'Reviewed script and revision required')
 demand([d.voice_approved_at,d.video_qa_approved_at,d.publication_approved_at].every(t=>dated(t,now)),'Existing final approvals required')
 demand(v.videoBytes instanceof Uint8Array&&v.videoBytes.length>=16&&v.videoBytes.length<=35*1024*1024&&Buffer.from(v.videoBytes.subarray(4,8)).toString('ascii')==='ftyp','Verified bounded MP4 required')
 demand(sha(v.videoBytes)===s.videoSha256&&!knownMarked.has(s.videoSha256)&&s.videoPath===`character-promos/${d.character_id}/${d.id}/${s.videoSha256}.mp4`&&d.video_asset_path===s.videoPath,'Exact clean private media required')
 for(const name of checks){const q=v.qa.filter(q=>q.promo_id===d.id&&q.video_sha256===s.videoSha256&&q.check_name===name);demand(q.length===1&&q[0].result==='pass'&&q[0].reviewer_id&&uuid(q[0].reviewer_id)&&q[0].evidence.trim()&&dated(q[0].created_at,now),`Attributed current-video QA required: ${name}`)}
 demand(c.character_id===d.character_id&&c.live&&c.production_ready&&c.rights_status==='approved'&&c.voice_status==='canonical'&&hash(c.revision_sha256)&&hash(c.portrait_sha256)&&c.primary_asset_id&&c.voice_id&&fresh(c.checked_at,now),'Fresh canonical rights required')
 demand(x.verified&&fresh(x.checked_at,now)&&x.brand_id===s.brandId&&x.user_id===s.userId&&x.timezone===s.timezone&&x.accounts.filter(a=>a.network===s.network&&a.account_id===s.accountId).length===1,'Fresh provider account proof required')
 demand(s.contentApprovalDigest===cafeContentEvidenceDigest(v),'Content evidence digest changed')
 // sourceState must be the complete SQL source_state result, not a reduced UI projection.
 const state=candidate.sourceState as {draft?:unknown;plan?:unknown;qa?:unknown}
 demand(state&&stable(state.draft)===stable(d)&&stable(state.plan)===stable(p)&&stable(state.qa)===stable([...v.qa].sort((a,b)=>a.id.localeCompare(b.id))),'Full SQL source-state binding required')
}
export type CafeApprovalWriterDeps={
 now():number
 auth():Promise<{id:string;isContentAdmin:boolean}|null>
 /** Trusted bounded server reads; never accepts client snapshot, actor or QA. */
 load(planId:string):Promise<CafeApprovalCandidate>
 /** Verify original owner-authored scope; null for ambiguity, stale or missing permission. */
 ownerAuthority(schedule:CafeSchedule,digest:string):Promise<CafeOwnerAuthority|null>
 /** Atomic parent lock/source CAS/actor recheck, insert-only and durable readback.
  * No transport retries. Implementation and grants require separate SQL review. */
 persist(input:{planId:string;snapshot:CafeSchedule;digest:string;destinationTimeKey:string;mediaDestinationKey:string;sourceState:unknown;actor:string;approvedAt:string;expiresAt:string;authority:CafeOwnerAuthority}):Promise<{digest:string;expiresAt:string}|null>
}
export async function recordCafeScheduleAuthority(input:{planId:string;expectedDigest:string},deps:CafeApprovalWriterDeps,options:{enabled?:boolean}={}){
 if(options.enabled!==true)return {status:'disabled' as const}
 demand(uuid(input.planId)&&hash(input.expectedDigest),'Exact expected plan required')
 const user=await deps.auth();demand(user?.isContentAdmin===true&&uuid(user.id),'Authenticated content admin required')
 const loaded=await deps.load(input.planId)
 // Retain actual bytes but isolate every nested mutable source before awaits.
 const candidate={...JSON.parse(JSON.stringify({...loaded,sources:{...loaded.sources,videoBytes:undefined}})),sources:{...JSON.parse(JSON.stringify({...loaded.sources,videoBytes:undefined})),videoBytes:Uint8Array.from(loaded.sources.videoBytes)}} as CafeApprovalCandidate
 demand(candidate.schedule.planId===input.planId,'Foreign plan')
 validate(candidate,deps.now());const digest=cafeScheduleDigest(candidate.schedule)
 demand(digest===input.expectedDigest,'Expected schedule changed')
 const authority=await deps.ownerAuthority(JSON.parse(JSON.stringify(candidate.schedule)),digest)
 const a=authority?JSON.parse(JSON.stringify(authority)) as CafeOwnerAuthority:null,now=deps.now()
 demand(a&&!a.revoked&&a.scheduleDigest===digest&&/^[A-Za-z0-9_.:-]{1,200}$/.test(a.reference)&&dated(a.authorizedAt,now)&&Date.parse(a.expiresAt)>now,'Owner publication authority missing or expired')
 validate(candidate,now)
 const expires=Math.min(Date.parse(a.expiresAt),Date.parse(candidate.schedule.scheduledAt)-60000,now+24*3600000)
 demand(expires>now,'No valid approval interval')
 const expiresAt=new Date(expires).toISOString()
 const saved=await deps.persist({planId:input.planId,snapshot:candidate.schedule,digest,...cafeReservationKeys(candidate.schedule),sourceState:candidate.sourceState,actor:user.id,approvedAt:new Date(now).toISOString(),expiresAt,authority:a})
 demand(saved?.digest===digest&&saved.expiresAt===expiresAt,'Approval persistence unconfirmed; reconcile before retry')
 return {status:'recorded' as const,digest,expiresAt,scheduled:false,published:false,qaCreated:false}
}

/** Only a bounded abort-aware server RPC adapter may be supplied; no retries. */
export function createCafeApprovalPersistence(rpc:(name:'cs_record_cafe_metricool_authority',args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>):CafeApprovalWriterDeps['persist']{
 return async i=>{
  const r=await rpc('cs_record_cafe_metricool_authority',{p_plan:i.planId,p_snapshot:i.snapshot,p_digest:i.digest,p_destination:i.destinationTimeKey,p_media:i.mediaDestinationKey,p_source:i.sourceState,p_actor:i.actor,p_approved_at:i.approvedAt,p_expires_at:i.expiresAt,p_authority:i.authority})
  if(r.error)throw Error('Authority write unconfirmed; reconcile before retry')
  const v=r.data as {digest?:unknown;expiresAt?:unknown}|null
  return v&&v.digest===i.digest&&v.expiresAt===i.expiresAt?{digest:i.digest,expiresAt:i.expiresAt}:null
 }
}

/** Read-only validation for an owner preview. Never records or fabricates authority. */
export {validate as validateCafeApprovalCandidate}
