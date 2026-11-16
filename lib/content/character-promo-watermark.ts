/** Human-reviewed exact-byte policy, not an automated visual detector. A sampled
 * clean frame does not establish a full-clip pass. Ecosystem marks are permitted
 * only when the reviewer identifies their authorization in evidence. */
export const WATERMARK_QA='third_party_watermark' as const
export const KNOWN_THIRD_PARTY_MARKED_SHA256=Object.freeze([
 'a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d',
 'ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7',
 '70f2ad3fe14420e472908850576b3240bbad2a3e6d121ae2f89a7da77148f4e0',
])
export type WatermarkObservation={promo_id:string;video_sha256:string;check_name:string;result:string;evidence:string;reviewer_id:string|null;created_at:string}
export function watermarkReadiness(promoId:string,sha256:string,observations:readonly WatermarkObservation[]){
 if(!/^[a-f0-9]{64}$/.test(sha256))return {ready:false,reason:'invalid_media_hash'}
 if(KNOWN_THIRD_PARTY_MARKED_SHA256.includes(sha256))return {ready:false,reason:'known_third_party_watermark'}
 const rows=observations.filter(q=>q.promo_id===promoId&&q.video_sha256===sha256&&q.check_name===WATERMARK_QA)
 if(rows.length!==1)return {ready:false,reason:'watermark_review_required'}
 const q=rows[0]
 if(q.result!=='pass'||!q.reviewer_id||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(q.reviewer_id)||typeof q.evidence!=='string'||!q.evidence.trim()||q.evidence.length>1000||!Number.isFinite(Date.parse(q.created_at)))return {ready:false,reason:'watermark_review_not_passed'}
 return {ready:true,reason:'reviewed_exact_media'}
}
