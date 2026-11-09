import 'server-only'
import { createCharacterPromoControls } from './character-promo-controls'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { liveGlyphCharacters } from './glyph-live'
import { unseal } from './metricool-oauth'
import { metricoolSession } from './metricool-mcp'
import { readPromoMetricoolBrands, PromoConnectionReadError } from './character-promo-metricool-readonly'
import { readCharacterPromoMaterial, readVerifiedPromoBytes } from './character-promo-material'
import { readCharacterPromoSources, normalizePromoCanon, PromoSourceError } from './character-promo-sources'
import { readCharacterPromoGates, beginCharacterPromoReview, confirmCharacterPromoGate } from './character-promo-confirmation'
import { buildCharacterPromoReview } from './character-promo-review'
import { prepareCharacterPromo, promoSnapshotDigest } from './character-promo-delivery'
import { approveCharacterPromo } from './character-promo-approval'
import { createPromoHttpHandlers } from './character-promo-http'
import { promoVisibleMaterialMatches } from './character-promo-visible-match'

export const personaReviewRuntimeEnabled=()=>process.env.CS_PERSONA_REVIEW_RUNTIME_ENABLED==='true'
/** Lazy server-only construction. Disabled requests never construct an admin client. */
export function personaReviewHandlers() {
 let db:ReturnType<typeof createAdminClient>|undefined
 const database=()=>db||(db=createAdminClient())
 const auth=()=>createClient().auth
 const readSources=async(planId:string)=>{
  let connectionFailure:PromoConnectionReadError|null=null
  try {return await readCharacterPromoSources(planId,{db:database(),now:Date.now,readGlyph:liveGlyphCharacters,readMetricoolBrands:async()=>{
   try {return await readPromoMetricoolBrands({db:database(),now:Date.now,decrypt:value=>unseal(value,'credentials'),openSession:metricoolSession})}catch(e){if(e instanceof PromoConnectionReadError)connectionFailure=e;throw e}
  }})}catch(e){if(connectionFailure)throw connectionFailure;throw e}
 }
 const actionDeps=()=>({auth:auth(),readSources,db:database(),now:Date.now})
 const verifiedActor=async()=>{const r=await auth().getUser();if(r.error||!r.data.user||r.data.user.app_metadata?.cafe_sativa_admin!==true)throw Error('Authenticated admin required');return r.data.user.id}
 return createPromoHttpHandlers({
  enabled:personaReviewRuntimeEnabled,
  authorize:async()=>{const r=await auth().getUser();return !r.error && r.data.user?.app_metadata?.cafe_sativa_admin===true},
  preview:(id,sha)=>readVerifiedPromoBytes(database(),id,sha),
  view:async planId=>{
   const candidate=await readCharacterPromoMaterial(planId,database())
   let controls:Awaited<ReturnType<ReturnType<typeof createCharacterPromoControls>['read']>>|null=null
   try {controls=await createCharacterPromoControls((name,args)=>database().rpc(name,args),await verifiedActor()).read(planId)}catch{}
   if(candidate.blockers.length) {
    let canonicalMaterial:unknown=null,canonicalBlocker:string|null=null
    try {canonicalMaterial=normalizePromoCanon(await liveGlyphCharacters(),candidate.draft.characterId,new Date().toISOString())}catch{canonicalBlocker='Live canonical verification unavailable; no canonical approval is inferred.'}
    return {candidate,controls,canonicalMaterial,canonicalBlocker,review:null,executionReview:null,reviewBlocker:{code:'candidate_not_ready',message:'Candidate material is available. Resolve the explicitly missing fields and QA before final confirmation.'}}
   }
   try {
    if(!controls||controls.withdrawn)throw Error('Plan controls unavailable or target withdrawn')
    const sources=await readSources(planId)
    if(!promoVisibleMaterialMatches(candidate,sources))throw Error('Candidate changed; reload exact material')
    const state=await readCharacterPromoGates(database(),planId),review=buildCharacterPromoReview(sources,state)
    const snapshot=(review.readyForSeparateDeliveryApproval||(review.dispatchPrerequisitesMet&&!controls.targetAttemptState))?prepareCharacterPromo(sources):null
    return {candidate,controls,canonicalMaterial:sources.canon,canonicalBlocker:null,review,executionReview:snapshot?{snapshot,digest:promoSnapshotDigest(snapshot)}:null,reviewBlocker:null}
   }catch(e){return {candidate,controls,canonicalMaterial:null,canonicalBlocker:null,review:null,executionReview:null,reviewBlocker:e instanceof PromoConnectionReadError||e instanceof PromoSourceError?{code:e.code,message:e.message}:{code:'review_evidence_unavailable',message:'Current review evidence is unavailable; no approval was inferred.'}}}
  },
  action:async b=>{
   const explicitConfirmation=true as const
   if(b.action==='begin_review'||b.action==='replace_review')return beginCharacterPromoReview({planId:b.planId as string,action:b.action,contentDigest:b.contentDigest as string,reviewedStateDigest:b.reviewedStateDigest as string,explicitConfirmation},actionDeps())
   if(b.action==='voice'||b.action==='video'||b.action==='publication')return confirmCharacterPromoGate({planId:b.planId as string,gate:b.action,contentDigest:b.contentDigest as string,reviewedStateDigest:b.reviewedStateDigest as string,explicitConfirmation},actionDeps())
   if(b.action==='delivery_approval')return approveCharacterPromo({planId:b.planId as string,reviewedDigest:b.reviewedDigest as string},{auth:auth(),readSources,rpc:(name,args)=>database().rpc(name,args),now:Date.now})
   if(b.action==='record_qa') {
    // Verify the exact currently stored bytes, then refresh reviewer identity before SQL CAS.
    await readVerifiedPromoBytes(database(),b.promoId as string,b.videoSha256 as string)
    const actor=await verifiedActor()
    if(typeof actor!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(actor))throw Error('Verified reviewer identity required')
    const r=await database().rpc('cs_record_character_promo_qa_observation',{p_promo_id:b.promoId,p_video_sha256:b.videoSha256,p_draft_revision:b.draftRevision,p_check_name:b.checkName,p_result:b.result,p_evidence:b.evidence,p_expected_observation:b.expectedObservation,p_actor:actor})
    const q=r.data
    if(r.error||!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).sort().join(',')!=='check_name,created_at,evidence,id,promo_id,result,reviewer_id,video_sha256'||typeof q.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(q.id)||q.promo_id!==b.promoId||q.video_sha256!==b.videoSha256||q.check_name!==b.checkName||q.result!==b.result||q.evidence!==b.evidence||q.reviewer_id!==actor||typeof q.created_at!=='string'||!Number.isFinite(Date.parse(q.created_at)))throw Error('QA observation result unconfirmed; reload before retrying')
    return {saved:true,observation:q,approvalGranted:false,qaApproved:false,publicationApproved:false}
   }
   const actor=await verifiedActor()
   const controls=createCharacterPromoControls((name,args)=>database().rpc(name,args),actor)
   if(b.action==='review_plan_control') {const result=await controls.review({planId:b.planId as string,action:b.controlAction as 'withdraw'|'restore'});return 'snapshot' in result?{review:result}:result}
   if(b.action==='save_plan_control')return {result:await controls.save(b.review as {snapshot:unknown;digest:string}),saved:true,approvalGranted:false}
   if(b.action==='reconcile_plan_control')return {result:await controls.reconcile({reviewId:b.reviewId as string}),approvalGranted:false}
   if(b.action==='review_plan_edit') {
    const r=await database().rpc('cs_review_character_promo_plan_edit',{p_plan_id:b.planId,p_caption:b.caption,p_scheduled_at:b.scheduledAt,p_actor:actor})
    if(r.error||!r.data||typeof r.data.digest!=='string'||!r.data.snapshot)throw Error('Plan changes could not be reviewed')
    return {review:r.data,saved:false,approvalGranted:false}
   }
   if(b.action==='save_plan_edit') {
    const review=b.review as {snapshot:{actor?:string;expected?:{plan?:{id?:string}};changes?:{caption?:string;scheduledAt?:string}};digest:unknown}
    if(!review.snapshot||review.snapshot.actor!==actor||typeof review.snapshot.expected?.plan?.id!=='string'||typeof review.snapshot.changes?.caption!=='string'||typeof review.snapshot.changes?.scheduledAt!=='string'||typeof review.digest!=='string'||!/^[a-f0-9]{64}$/.test(review.digest))throw Error('Exact reviewed change required')
    const r=await database().rpc('cs_save_character_promo_plan_edit',{p_snapshot:review.snapshot,p_digest:review.digest,p_actor:actor})
    if(r.error||!r.data||r.data.consentInvalidated!==true||r.data.planId!==review.snapshot.expected?.plan?.id||r.data.caption!==review.snapshot.changes?.caption||r.data.scheduledAt!==review.snapshot.changes?.scheduledAt)throw Error('Plan save result unconfirmed; reload before retrying')
    return {saved:true,result:r.data,approvalGranted:false}
   }
   throw Error('Unsupported action')
  },
 })
}
