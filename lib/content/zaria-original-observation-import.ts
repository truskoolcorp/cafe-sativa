import {zariaOriginalObservations} from './zaria-original-observations.ts'
import {originalQaTarget} from './character-production-original-qa.ts'
export const zariaObservationTarget={...originalQaTarget,revision:'2026-11-14T20:22:57.862774+00:00',script:"Welcome to the Gallery at Café Sativa. I'm Zaria Solenne. Every piece has a story, and I'd love to help you discover yours."} as const
export type Observation=Record<string,unknown>
const fields=['check_name','created_at','evidence','id','promo_id','result','reviewer_id','video_sha256'].sort().join(',')
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function validateZariaCanon(value:unknown){
 const root=value as {live?:unknown;characters?:Record<string,unknown>[]}
 if(root?.live!==true||!Array.isArray(root.characters))throw Error('Canonical source unavailable')
 const matches=root.characters.filter(c=>c.id==='zaria-solenne'),c=matches[0]
 if(matches.length!==1||c.primary_asset_id!=='473df9fd-b48c-4f01-a89a-499de631b954'||c.sha256!=='ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca'||c.voice_id!=='5zneNR4v1Uw5AjIZ9Un4'||c.voice_status!=='canonical'||c.rights_status!=='approved'||c.requires_rights_consent!==false||c.production_ready!==true||!Array.isArray(c.blockers)||c.blockers.length!==0)throw Error('Canonical evidence changed')
}
export function validateZariaDraft(d:Record<string,unknown>){
 const t=zariaObservationTarget
 if(d.id!==t.promoId||d.character_id!==t.characterId||d.spoken_script!==t.script||d.video_asset_path!==`character-promos/${t.characterId}/${t.promoId}/${t.sha}.mp4`||typeof d.updated_at!=='string'||!['2026-11-14T20:22:57.862774+00:00','2026-11-14 20:22:57.862774+00'].includes(d.updated_at)||d.status!=='draft'||d.duration_seconds!==8||d.audio_asset_path!==null||d.voice_approved_at!==null||d.video_qa_approved_at!==null||d.publication_approved_at!==null)throw Error('Original draft changed')
}
export async function importZariaObservations(d:{signal:AbortSignal;readDraft():Promise<Record<string,unknown>>;readCanon():Promise<unknown>;verifyMedia():Promise<{sha:string;bytes:number}>;readObservations():Promise<Observation[]>;actor():Promise<string>;rpc(args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>}){
 const t=zariaObservationTarget,check=()=>{if(d.signal.aborted)throw Error('Import cancelled')}
 const draft=await d.readDraft();validateZariaDraft(draft);check();validateZariaCanon(await d.readCanon());check()
 const media=await d.verifyMedia();if(media.sha!==t.sha||media.bytes!==t.bytes)throw Error('Original bytes changed');check()
 const rows=await d.readObservations();if(rows.length>9)throw Error('Unexpected observations')
 const names=new Set<string>();for(const row of rows){if(Object.keys(row).sort().join(',')!==fields||row.promo_id!==t.promoId||row.video_sha256!==t.sha||typeof row.id!=='string'||!uuid.test(row.id)||typeof row.reviewer_id!=='string'||!uuid.test(row.reviewer_id)||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at))||typeof row.check_name!=='string'||names.has(row.check_name)||!zariaOriginalObservations.some(x=>x.check_name===row.check_name))throw Error('Observation snapshot changed');names.add(row.check_name)}
 for(const prior of rows){const expected=zariaOriginalObservations.find(o=>o.check_name===prior.check_name)!;if(prior.result!==expected.result||prior.evidence!==expected.evidence)throw Error('Existing observation requires reconciliation')}
 let saved=0,alreadyRecorded=0
 for(const observation of zariaOriginalObservations){
  check();const prior=rows.find(q=>q.check_name===observation.check_name)
  if(prior){if(prior.result===observation.result&&prior.evidence===observation.evidence){alreadyRecorded++;continue}throw Error('Existing observation requires reconciliation')}
  // Refresh real actor before each existing SQL CAS. This is submission identity,
  // never a claim that this person manually watched or approved the clip.
  const actor=await d.actor();if(!uuid.test(actor))throw Error('Verified admin required');check()
  const r=await d.rpc({p_promo_id:t.promoId,p_video_sha256:t.sha,p_draft_revision:draft.updated_at,p_check_name:observation.check_name,p_result:observation.result,p_evidence:observation.evidence,p_expected_observation:null,p_actor:actor});check()
  const q=r.data as Observation
  if(r.error||!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).sort().join(',')!==fields||typeof q.id!=='string'||!uuid.test(q.id)||q.promo_id!==t.promoId||q.video_sha256!==t.sha||q.check_name!==observation.check_name||q.result!==observation.result||q.evidence!==observation.evidence||q.reviewer_id!==actor||typeof q.created_at!=='string'||!Number.isFinite(Date.parse(q.created_at)))throw Error('Observation receipt unconfirmed; reload before retry')
  saved++
 }
 const final=await d.readObservations();check()
 if(final.length!==9||zariaOriginalObservations.some(o=>final.filter(q=>q.promo_id===t.promoId&&q.video_sha256===t.sha&&q.check_name===o.check_name&&q.result===o.result&&q.evidence===o.evidence).length!==1))throw Error('Observation readback unconfirmed')
 return {saved,alreadyRecorded,checks:9,passes:8,needsReview:['lip_sync'],qaApproved:false,publicationApproved:false,automatedIngestionProven:false} as const
}
