import { normalizePromoDatabaseTime } from './character-promo-time'
import { createHash } from 'node:crypto'
import type { PromoSourceClient } from './character-promo-sources'
import { PROMO_QA } from './character-promo-delivery'

export class PromoMaterialError extends Error {constructor(readonly code:string,message:string){super(message);this.name='PromoMaterialError'}}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SHA=/^[a-f0-9]{64}$/
const canonicalDate=(value:unknown)=>normalizePromoDatabaseTime(value)??(typeof value==='string'?value:null)
const hash=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex')
async function read<T>(fn:()=>PromiseLike<T>,code:string):Promise<T>{try{return await fn()}catch{throw new PromoMaterialError(code,'Candidate source read failed')}}
/** Candidate material is NOT an approvable snapshot. Missing QA, caption or time stay missing. */
export async function readCharacterPromoMaterial(planId:string,db:PromoSourceClient,now=Date.now()) {
 if(!UUID.test(planId))throw new PromoMaterialError('plan_id_invalid','Valid plan UUID required')
 const planResult=await read(()=>db.from('cs_character_promo_delivery_plans').select('id,promo_id,character_id,network,account_id,caption,scheduled_at,status').eq('id',planId).maybeSingle(),'plan_read_failed')
 const p=planResult.data
 if(planResult.error||!p||p.id!==planId||!UUID.test(p.promo_id))throw new PromoMaterialError('plan_unavailable','Candidate plan unavailable; reviewed caption schema is required')
 const material=await readPromoAssetMaterial(p.promo_id,db,now,p)
 if(!material.plan)throw new PromoMaterialError('plan_unavailable','Candidate plan unavailable')
 return {...material,plan:material.plan}
}
/** Asset-only review never chooses or creates a delivery plan, even if one exists. */
export async function readCharacterPromoAssetMaterial(promoId:string,db:PromoSourceClient,now=Date.now()) {
 if(!UUID.test(promoId))throw new PromoMaterialError('promo_id_invalid','Valid promotion UUID required')
 return readPromoAssetMaterial(promoId,db,now,null)
}
async function readPromoAssetMaterial(promoId:string,db:PromoSourceClient,now:number,p:any|null) {
 const draftResult=await read(()=>db.from('cs_character_promo_drafts').select('id,character_id,title,spoken_script,visual_brief,duration_seconds,status,video_asset_path,updated_at').eq('id',promoId).maybeSingle(),'draft_read_failed')
 const d=draftResult.data
 if(draftResult.error||!d||d.id!==promoId||(p&&p.character_id!==d.character_id)||typeof d.character_id!=='string'||!/^[-a-z0-9]+$/.test(d.character_id)||typeof d.spoken_script!=='string')throw new PromoMaterialError('draft_unavailable','Candidate script and identity unavailable')
 const sha=typeof d.video_asset_path==='string'?d.video_asset_path.match(/\/([a-f0-9]{64})\.mp4$/)?.[1]:null
 if(!sha||d.video_asset_path!==`character-promos/${d.character_id}/${d.id}/${sha}.mp4`)throw new PromoMaterialError('media_unfinalized','Candidate does not have a finalized exact-hash private MP4')
 const video=await readVerifiedPromoBytes(db,d.id,sha)
 const qaResult=await read(()=>db.from('cs_character_promo_qa_checks').select('id,promo_id,video_sha256,check_name,result,evidence,reviewer_id,created_at').eq('promo_id',d.id).eq('video_sha256',sha).limit(9),'qa_read_failed')
 if(qaResult.error||!Array.isArray(qaResult.data)||qaResult.data.length>8)throw new PromoMaterialError('qa_unavailable','Candidate QA observations unavailable or ambiguous')
 const qa=qaResult.data
 if(qa.some(q=>q.promo_id!==d.id||q.video_sha256!==sha))throw new PromoMaterialError('qa_identity_invalid','Candidate QA does not match this exact media')
 const checks=PROMO_QA.map(name=>({name,observations:qa.filter(q=>q.check_name===name),passed:qa.filter(q=>q.check_name===name).length===1&&qa.find(q=>q.check_name===name)?.result==='pass'}))
 const blockers:string[]=[]
 if(d.status!=='script_approved')blockers.push('script_approval_pending')
 if(!p)blockers.push('delivery_plan_not_selected','destination_not_verified_for_delivery','future_schedule_not_authored')
 if(p) {
 if(typeof p.caption!=='string'||!p.caption.trim())blockers.push('caption_not_authored')
 if(!normalizePromoDatabaseTime(p.scheduled_at,true))blockers.push('schedule_precision_requires_explicit_reauthor')
 if(!Number.isFinite(Date.parse(p.scheduled_at))||Date.parse(p.scheduled_at)<=now+60000)blockers.push('future_schedule_not_authored')
 if(d.character_id!=='keith'||!((p.network==='facebook'&&p.account_id==='146219355471397')||(p.network==='threads'&&p.account_id==='truskoolcorp')))blockers.push('destination_not_verified_for_delivery')
 }
 for(const check of checks)if(!check.passed)blockers.push(`qa_${check.name}_pending`)
 const current=await read(()=>db.from('cs_character_promo_drafts').select('id,character_id,title,spoken_script,visual_brief,duration_seconds,status,video_asset_path,updated_at').eq('id',d.id).maybeSingle(),'draft_read_failed')
 if(current.error||JSON.stringify(current.data)!==JSON.stringify(d))throw new PromoMaterialError('candidate_changed','Candidate material changed during review; reload')
 if(p) {
 const currentPlan=await read(()=>db.from('cs_character_promo_delivery_plans').select('id,promo_id,character_id,network,account_id,caption,scheduled_at,status').eq('id',p.id).maybeSingle(),'plan_read_failed')
 if(currentPlan.error||JSON.stringify(currentPlan.data)!==JSON.stringify(p))throw new PromoMaterialError('candidate_changed','Candidate plan changed during review; reload')
 }
 return {kind:'candidate_material' as const,approvalGranted:false as const,plan:p?{id:p.id,network:p.network,accountId:p.account_id,caption:typeof p.caption==='string'?p.caption:null,scheduledAt:canonicalDate(p.scheduled_at),status:p.status}:null,draft:{id:d.id,characterId:d.character_id,title:d.title,script:d.spoken_script,visualBrief:d.visual_brief,targetDurationSeconds:d.duration_seconds,status:d.status,revision:canonicalDate(d.updated_at)},video:{sha256:sha,bytes:video.bytes.length,previewPath:`/api/admin/programming/character-promos/review-media?promoId=${d.id}&sha256=${sha}`},checks,blockers,canonicalVerification:'not_asserted_by_candidate_material' as const}
}
/** Authenticated caller required. No signed URL, upload, provider call or historical fallback. */
export async function readVerifiedPromoBytes(db:PromoSourceClient,promoId:string,sha:string) {
 if(!UUID.test(promoId)||!SHA.test(sha))throw new PromoMaterialError('media_identity_invalid','Exact promo UUID and SHA-256 required')
 const result=await read(()=>db.from('cs_character_promo_drafts').select('id,character_id,video_asset_path').eq('id',promoId).maybeSingle(),'media_identity_read_failed')
 const d=result.data
 if(result.error||!d||d.id!==promoId||typeof d.character_id!=='string'||!/^[-a-z0-9]+$/.test(d.character_id)||d.video_asset_path!==`character-promos/${d.character_id}/${promoId}/${sha}.mp4`)throw new PromoMaterialError('media_changed','Requested video is not this promotion’s current finalized media')
 const file=await read(()=>db.storage.from('cafe-sativa-content').download(d.video_asset_path),'media_read_failed')
 if(file.error||!file.data||!Number.isSafeInteger(file.data.size)||file.data.size<16||file.data.size>35*1024*1024)throw new PromoMaterialError('media_size_invalid','Private MP4 is unavailable or outside the supported size limit')
 const bytes=new Uint8Array(await read(()=>file.data!.arrayBuffer(),'media_bytes_failed'))
 if(bytes.length!==file.data.size||Buffer.from(bytes).toString('ascii',4,8)!=='ftyp'||hash(bytes)!==sha)throw new PromoMaterialError('media_integrity_invalid','Private MP4 failed exact byte/hash verification')
 const current=await read(()=>db.from('cs_character_promo_drafts').select('id,character_id,video_asset_path').eq('id',promoId).maybeSingle(),'media_identity_read_failed')
 if(current.error||JSON.stringify(current.data)!==JSON.stringify(d))throw new PromoMaterialError('media_changed','Requested media changed during verification')
 return {bytes,sha256:sha,promoId}
}
