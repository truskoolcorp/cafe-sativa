import type { PromoReviewSources } from './character-promo-sources'
import { createHash } from 'node:crypto'
import { characterPromoAudioStatus } from './character-promo-audio'
import { PROMO_QA, PromoSnapshot } from './character-promo-delivery'

// LOCAL REVIEW WORKFLOW ONLY. No route, live approval, scheduler, credentials or dispatch.
export const CONTENT_GATES=['voice','video','publication'] as const
export type ContentGate=typeof CONTENT_GATES[number]
export type PromoReviewContent=Omit<PromoSnapshot,'approvals'|'draftRevision'>
export type PromoReviewExpected={generationId:string|null;planStatus:string;draftRevision:string;voiceApprovedAt:string|null;videoApprovedAt:string|null;publicationApprovedAt:string|null}
export type PromoGateEvidence={generationId:string;gate:ContentGate;contentDigest:string;content:PromoReviewContent;confirmedBy:string;confirmedAt:string;invalidated:boolean}
export type PromoGateState={generationId:string|null;generationContentDigest:string|null;invalidated:boolean;gates:PromoGateEvidence[];hasSharedAttempt:boolean;pendingSiblingGatePlans:number;pendingSiblingDeliveryApprovals:number;ownDeliveryApprovalCurrent:boolean}
export class PromoReviewError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='PromoReviewError'}
}
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value && typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'
  return JSON.stringify(value)
}
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex')
export const promoReviewDigest=(content:PromoReviewContent)=>hash(canonical(content))
export const promoReviewedStateDigest=(content:PromoReviewContent,expected:PromoReviewExpected)=>hash(canonical({content,expected}))
const goodDate=(value:unknown,now:number)=>typeof value==='string' && Number.isFinite(Date.parse(value)) && Date.parse(value)<=now

/** Pre-confirmation model. Never creates substitute timestamps to pass execution guards. */
export function buildCharacterPromoReview(s:PromoReviewSources,state:PromoGateState,now=Date.now()) {
  const {draft:d,plan:p,canon:c,connection:x}=s
  const blockers:string[]=[]
  const check=(ok:unknown,code:string)=>{if(!ok)blockers.push(code)}
  check(Number.isFinite(now),'clock_invalid')
  check(state.generationId===null?state.generationContentDigest===null:typeof state.generationContentDigest==='string' && /^[a-f0-9]{64}$/.test(state.generationContentDigest),'generation_content_digest_invalid')
  check(typeof state.hasSharedAttempt==='boolean' && typeof state.ownDeliveryApprovalCurrent==='boolean' && Number.isSafeInteger(state.pendingSiblingGatePlans) && state.pendingSiblingGatePlans>=0 && Number.isSafeInteger(state.pendingSiblingDeliveryApprovals) && state.pendingSiblingDeliveryApprovals>=0,'review_state_invalid')
  check(d.id && p.id && p.promo_id===d.id && p.character_id===d.character_id,'plan_ownership_mismatch')
  check(d.character_id==='keith' && d.intended_channel==='truskoolcorp_metricool_brand_5373515' && d.actual_social_account==='metricool-brand:5373515','persona_mapping_unverified')
  check((p.network==='facebook' && p.account_id==='146219355471397') || (p.network==='threads' && p.account_id==='truskoolcorp'),'destination_unverified')
  check(['blocked_assets','ready_for_delivery'].includes(p.status),'plan_not_reviewable')
  check(d.status==='script_approved','script_not_approved')
  check(d.spoken_script.trim() && d.visual_brief.trim() && Number.isInteger(d.duration_seconds) && d.duration_seconds>=8 && d.duration_seconds<=45,'reviewed_content_invalid')
  check(goodDate(d.updated_at,now),'draft_revision_invalid')
  check(p.caption.trim() && Array.from(p.caption).length<=500,'caption_invalid')
  check(Number.isFinite(Date.parse(p.scheduled_at)) && Date.parse(p.scheduled_at)>now+60000 && new Date(p.scheduled_at).toISOString()===p.scheduled_at,'schedule_invalid')
  check(typeof c.canonical_context==='string' && c.canonical_context.trim() && c.live && goodDate(c.checked_at,now) && now-Date.parse(c.checked_at)<=60000 && c.character_id===d.character_id && c.rights_status==='approved' && c.voice_status==='canonical' && c.production_ready && c.primary_asset_id && /^[a-f0-9]{64}$/.test(c.portrait_sha256) && /^[a-f0-9]{64}$/.test(c.revision_sha256) && c.voice_id,'canon_or_rights_unverified')
  check(x.verified && goodDate(x.checked_at,now) && now-Date.parse(x.checked_at)<=60000 && x.brand_id==='5373515' && x.user_id==='4174093' && x.accounts.length===2 && x.accounts.filter(a=>a.network==='facebook' && a.account_id==='146219355471397').length===1 && x.accounts.filter(a=>a.network==='threads' && a.account_id==='truskoolcorp').length===1,'connection_unverified')
  try {new Intl.DateTimeFormat('en-US',{timeZone:x.timezone}).format(now);check(Boolean(x.timezone.trim()),'timezone_invalid')} catch {blockers.push('timezone_invalid')}
  const videoSha256=hash(s.videoBytes)
  check(s.videoBytes.length>=16 && s.videoBytes.length<=35*1024*1024 && Buffer.from(s.videoBytes).toString('ascii',4,8)==='ftyp','media_integrity_invalid')
  check(d.video_asset_path===`character-promos/${d.character_id}/${d.id}/${videoSha256}.mp4`,'current_media_hash_mismatch')
  const checks=PROMO_QA.map(name=>{
    const rows=s.qa.filter(q=>q.promo_id===d.id && q.video_sha256===videoSha256 && q.check_name===name)
    const pass=rows.length===1 && rows[0].result==='pass'
    check(pass,`qa_${name}_not_passed`)
    return {name,passed:pass,observations:rows}
  })
  // Evidence can be present while explicit final voice confirmation is still absent.
  check(characterPromoAudioStatus(d,s.qa).hasAudioEvidence,'speech_evidence_missing')
  const expected:PromoReviewExpected={generationId:state.generationId,planStatus:p.status,draftRevision:d.updated_at,voiceApprovedAt:d.voice_approved_at,videoApprovedAt:d.video_qa_approved_at,publicationApprovedAt:d.publication_approved_at}
  for(const stamp of [d.voice_approved_at,d.video_qa_approved_at,d.publication_approved_at])check(stamp===null || goodDate(stamp,now),'legacy_stamp_invalid')
  const content:PromoReviewContent|null=blockers.length?null:{version:1,planId:p.id,promoId:d.id,characterId:d.character_id,script:d.spoken_script,visualBrief:d.visual_brief,durationSeconds:d.duration_seconds,audioPath:d.audio_asset_path,videoPath:d.video_asset_path!,videoSha256,videoBytes:s.videoBytes.length,qa:s.qa.filter(q=>q.promo_id===d.id && q.video_sha256===videoSha256 && (PROMO_QA as readonly string[]).includes(q.check_name)).map(q=>({...q})).sort((a,b)=>a.check_name.localeCompare(b.check_name)),canon:{revisionSha256:c.revision_sha256,assetId:c.primary_asset_id,portraitSha256:c.portrait_sha256,voiceId:c.voice_id,rightsStatus:'approved',voiceStatus:'canonical',productionReady:true},caption:p.caption,scheduledAt:p.scheduled_at,network:p.network as PromoSnapshot['network'],accountId:p.account_id!,brandId:'5373515',userId:'4174093',timezone:x.timezone}
  const contentDigest=content?promoReviewDigest(content):null
  const contentBlockers=[...blockers]
  if(state.hasSharedAttempt)blockers.push('shared_promo_attempt_freezes_review')
  const generationContentChanged=Boolean(state.generationId && contentDigest && state.generationContentDigest!==contentDigest)
  let needsReplacement=state.invalidated || generationContentChanged
  if(generationContentChanged)blockers.push('generation_content_changed_requires_review')
  if(state.invalidated)blockers.push('confirmation_invalidated_requires_review')
  const evidence=state.gates
  const confirmed:Record<ContentGate,boolean>={voice:false,video:false,publication:false}
  let previousTime=-Infinity
  for(const gate of CONTENT_GATES) {
    if(state.invalidated || generationContentChanged)continue
    const rows=evidence.filter(r=>r.gate===gate)
    if(rows.length>1){blockers.push('confirmation_ambiguous');continue}
    const row=rows[0]
    if(!row)continue
    if(row.invalidated){needsReplacement=true;blockers.push('confirmation_invalidated_requires_review');continue}
    if(!state.generationId || row.generationId!==state.generationId || !contentDigest || row.contentDigest!==contentDigest || promoReviewDigest(row.content)!==contentDigest || !row.confirmedBy?.trim() || !goodDate(row.confirmedAt,now)) {needsReplacement=true;blockers.push('confirmation_stale_or_invalid');continue}
    if((gate==='video' && !confirmed.voice)||(gate==='publication' && (!confirmed.voice||!confirmed.video))||Date.parse(row.confirmedAt)<previousTime){blockers.push('confirmation_sequence_invalid');continue}
    confirmed[gate]=true;previousTime=Date.parse(row.confirmedAt)
  }
  const nextGate:ContentGate|null=blockers.length||!state.generationId?null:CONTENT_GATES.find(g=>!confirmed[g])||null
  const nextAction:ContentGate|'begin_review'|'replace_review'|null=contentBlockers.length||state.hasSharedAttempt?null:!state.generationId?'begin_review':needsReplacement?'replace_review':nextGate
  const dispatchBlockers:string[]=[]
  if(!CONTENT_GATES.every(g=>confirmed[g])||needsReplacement||contentBlockers.length)dispatchBlockers.push('current_content_confirmations_required')
  if(!state.ownDeliveryApprovalCurrent)dispatchBlockers.push('separate_current_delivery_approval_required')
  if(state.pendingSiblingGatePlans>0)dispatchBlockers.push('sibling_content_confirmations_pending')
  if(state.pendingSiblingDeliveryApprovals>0)dispatchBlockers.push('sibling_delivery_approvals_pending')
  return {canonicalContext:c.canonical_context,dispatchBlockers,dispatchPrerequisitesMet:dispatchBlockers.length===0,sharedDraftReviewFrozen:state.hasSharedAttempt,planId:p.id,content,contentDigest,expected,reviewedStateDigest:content?promoReviewedStateDigest(content,expected):null,checks,confirmed,nextGate,nextAction,blockers:[...new Set(blockers)],readyForSeparateDeliveryApproval:Boolean(state.generationId) && !blockers.length && CONTENT_GATES.every(g=>confirmed[g]),schedulingEnabled:false as const,legacyStampsAreApprovalEvidence:false as const}
}
