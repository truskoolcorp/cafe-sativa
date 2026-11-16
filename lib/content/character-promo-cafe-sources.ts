import {createHash} from 'node:crypto'
import type {SupabaseClient} from '@supabase/supabase-js'
import type {CafeApprovalCandidate} from './character-promo-cafe-approval'
import {cafeContentEvidenceDigest} from './character-promo-cafe-approval'
import type {CafeCollaborator,CafeNetwork,CafeSchedule} from './character-promo-cafe-metricool'
import {validateCafeSchedule} from './character-promo-cafe-metricool'
import {normalizePromoCanon} from './character-promo-sources'
import {normalizePromoDatabaseTime} from './character-promo-time'
import {createStreamingQaStorage} from './character-production-qa-storage'
import type {PromoSources} from './character-promo-delivery'

export class CafeSourceUnavailable extends Error {constructor(readonly code:string){super(code);this.name='CafeSourceUnavailable'}}
function fail(code:string):never{throw new CafeSourceUnavailable(code)}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)
const checks=['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']
/** Server-owned editorial metadata, not request JSON or synthesized QA. */
export type CafeEditorialMetadata={planId:string;promoId:string;videoSha256:string;network:CafeNetwork;caption:string;scheduledAt:string;hashtags:string[];facebookTitle?:string;collaborators:CafeCollaborator[];evidenceRef:string}
export type CafeSourceDeps={db:Pick<SupabaseClient,'from'|'storage'>;signal:AbortSignal;now():number;readGlyph(signal:AbortSignal):Promise<unknown>;readMetricoolBrands():Promise<unknown>;metadata:ReadonlyMap<string,CafeEditorialMetadata>;verifiedCollaborators:readonly CafeCollaborator[]}
async function records(planId:string,d:CafeSourceDeps){
 if(d.signal.aborted)fail('read_cancelled')
 const pr=await d.db.from('cs_character_promo_delivery_plans').select('*').eq('id',planId).limit(2).abortSignal(d.signal).retry(false)
 if(pr.error||!Array.isArray(pr.data)||pr.data.length!==1)fail('plan_missing_or_ambiguous')
 const plan=pr.data[0];if(plan.id!==planId||!uuid(plan.promo_id))fail('plan_identity_invalid')
 // Refuse old personal/Tru Skool plans before reading media or credentials.
 if(!(['facebook','instagram'].includes(plan.network))||plan.account_id!==(plan.network==='facebook'?'105363501666032':'cafesativainc'))fail('not_a_cafe_destination')
 const dr=await d.db.from('cs_character_promo_drafts').select('*').eq('id',plan.promo_id).limit(2).abortSignal(d.signal).retry(false)
 if(dr.error||!Array.isArray(dr.data)||dr.data.length!==1)fail('draft_missing_or_ambiguous')
 const draft=dr.data[0]
 if(draft.id!==plan.promo_id||draft.character_id!==plan.character_id||draft.actual_social_account!=='metricool-brand:7605217')fail('draft_destination_or_identity_invalid')
 if(typeof draft.character_id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(draft.character_id))fail('character_invalid')
 const path=typeof draft.video_asset_path==='string'?draft.video_asset_path:''
 const match=path.match(new RegExp('^character-promos/'+draft.character_id+'/'+draft.id+'/([a-f0-9]{64})\\.mp4$'))
 if(!match)fail('final_private_media_missing')
 // ALL QA rows, not just passing/current ones; source_state CAS includes history.
 const qr=await d.db.from('cs_character_promo_qa_checks').select('*').eq('promo_id',draft.id).order('id').limit(257).abortSignal(d.signal).retry(false)
 if(qr.error||!Array.isArray(qr.data)||qr.data.length>256)fail('qa_unavailable_or_over_limit')
 const qa=qr.data.sort((a:any,b:any)=>String(a.id).localeCompare(String(b.id)))
 if(qa.some((q:any)=>!uuid(q.id)||q.promo_id!==draft.id))fail('qa_identity_invalid')
 const raw={draft,plan,qa}
 if(Buffer.byteLength(stable(raw),'utf8')>262144)fail('source_snapshot_over_limit')
 return {raw,path,sha:match[1]}
}
/** Diagnostic is read-only and never interprets absent QA as permission. */
export async function diagnoseCafePlan(planId:string,d:CafeSourceDeps){
 if(!uuid(planId))return {ready:false,blockers:['invalid_plan_id']}
 try{const r=await records(planId,d);const blockers:string[]=[]
  if(r.raw.draft.status!=='script_approved')blockers.push('script_not_approved')
  if(r.raw.plan.status!=='ready_for_delivery')blockers.push('plan_not_ready')
  for(const name of checks){const found=r.raw.qa.filter((q:any)=>q.video_sha256===r.sha&&q.check_name===name);if(found.length!==1||found[0].result!=='pass'||!uuid(found[0].reviewer_id)||typeof found[0].evidence!=='string'||!found[0].evidence.trim())blockers.push('qa_missing_or_unverified:'+name)}
  for(const key of ['voice_approved_at','video_qa_approved_at','publication_approved_at'])if(!r.raw.draft[key])blockers.push('missing:'+key)
  if(!d.metadata.has(planId))blockers.push('platform_metadata_missing')
  return {ready:false,sourceChecksPassed:blockers.length===0,blockers,externalProofVerified:false}
 }catch(e){return {ready:false,blockers:[e instanceof CafeSourceUnavailable?e.code:'source_read_unconfirmed']}}
}
/** Real bounded database/private Storage reads and exact existing live sources.
 * No writes, permission creation, connection refresh or generic platform mapping. */
export async function loadCafeApprovalCandidate(planId:string,d:CafeSourceDeps):Promise<CafeApprovalCandidate>{
 if(!uuid(planId))fail('invalid_plan_id')
 const first=await records(planId,d),rawMeta=d.metadata.get(planId)
 if(!rawMeta)fail('platform_metadata_missing')
 const meta=JSON.parse(JSON.stringify(rawMeta)) as CafeEditorialMetadata
 const scheduledAt=normalizePromoDatabaseTime(first.raw.plan.scheduled_at,true)
 if(!scheduledAt||meta.planId!==planId||meta.promoId!==first.raw.draft.id||meta.videoSha256!==first.sha||meta.network!==first.raw.plan.network||meta.caption!==first.raw.plan.caption||meta.scheduledAt!==scheduledAt||! /^[A-Za-z0-9_.:-]{1,200}$/.test(meta.evidenceRef))fail('platform_metadata_binding_changed')
 const readiness=await diagnoseCafePlan(planId,d);if(!('sourceChecksPassed' in readiness)||!readiness.sourceChecksPassed)fail('final_qa_or_approvals_missing')
 const objects=createStreamingQaStorage(d.db.storage,15000),bucket=await objects.getBucket('cafe-sativa-content')
 if(bucket.error||bucket.data?.id!=='cafe-sativa-content'||bucket.data.public!==false)fail('private_bucket_unverified')
 const media=await objects.from('cafe-sativa-content').download(first.path,35*1024*1024)
 if(media.error||!media.data||media.data.length<16||Buffer.from(media.data.subarray(4,8)).toString('ascii')!=='ftyp'||createHash('sha256').update(media.data).digest('hex')!==first.sha)fail('private_media_hash_invalid')
 const canonAt=new Date(d.now()).toISOString(),canon=normalizePromoCanon(await d.readGlyph(d.signal),first.raw.draft.character_id,canonAt)
 const brandAt=new Date(d.now()).toISOString(),response:any=await d.readMetricoolBrands(),brands=Array.isArray(response)?response:response?.data
 const matches=Array.isArray(brands)?brands.filter((b:any)=>String(b.id)==='7605217'):[]
 if(matches.length!==1)fail('cafe_brand_missing_or_ambiguous')
 const b=matches[0]
 if(String(b.userId)!=='4174093'||b.timezone!=='America/Chicago'||String(b.networksData?.facebookData)!=='105363501666032'||b.networksData?.instagramData!=='cafesativainc')fail('cafe_provider_mapping_changed')
 const last=await records(planId,d)
 if(d.signal.aborted||stable(first.raw)!==stable(last.raw)||[canonAt,brandAt].some(t=>d.now()<Date.parse(t)||d.now()-Date.parse(t)>60000))fail('source_changed_or_expired')
 const sources={...last.raw,canon,connection:{verified:true,checked_at:brandAt,user_id:'4174093',brand_id:'7605217',timezone:'America/Chicago',accounts:[{network:'facebook',account_id:'105363501666032'},{network:'instagram',account_id:'cafesativainc'}]},videoBytes:media.data} as PromoSources
 const schedule:CafeSchedule={version:1,planId,promoId:last.raw.draft.id,characterId:last.raw.draft.character_id,brandId:'7605217',userId:'4174093',network:meta.network,accountId:last.raw.plan.account_id,timezone:'America/Chicago',scheduledAt,videoSha256:first.sha,videoPath:first.path,contentApprovalDigest:cafeContentEvidenceDigest(sources),caption:meta.caption,hashtags:meta.hashtags,collaborators:meta.collaborators,...(meta.network==='facebook'?{facebookTitle:meta.facebookTitle}:{})}
 validateCafeSchedule(schedule,d.verifiedCollaborators,d.now())
 return {schedule,sources,sourceState:last.raw,verifiedCollaborators:JSON.parse(JSON.stringify(d.verifiedCollaborators))}
}
