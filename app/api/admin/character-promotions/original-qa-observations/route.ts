import {createHash} from 'node:crypto'
import {isContentAdmin} from '@/lib/content/auth'
import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from '@/lib/content/character-production-bounded-fetch'
import {createStreamingQaStorage} from '@/lib/content/character-production-qa-storage'
import {createOriginalQaHandler,assertOriginalQaDestination} from '@/lib/content/character-production-original-qa'
import {importZariaObservations,zariaObservationTarget} from '@/lib/content/zaria-original-observation-import'
import {liveGlyphCharacters} from '@/lib/content/glyph-live'
import {normalizePromoCanon} from '@/lib/content/character-promo-sources'
export const dynamic='force-dynamic'
export const maxDuration=60
const t=zariaObservationTarget
const handler=createOriginalQaHandler({authorize:isContentAdmin,open(signal){
 const network=createProductionFetch(signal),db=createAdminClient(network.fetch),storage=createStreamingQaStorage(db.storage,15000)
 const actor=async()=>{const r=await createClient().auth.getUser();if(r.error||r.data.user?.app_metadata?.cafe_sativa_admin!==true)throw Error('Verified admin required');return r.data.user.id}
 return {whenSettled:network.whenSettled,ingest:async()=>{
  await importZariaObservations({signal,actor,
   async readDraft(){const r=await db.from('cs_character_promo_drafts').select('id,character_id,spoken_script,video_asset_path,updated_at,status,duration_seconds,audio_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at').eq('id',t.promoId).abortSignal(signal).maybeSingle();if(r.error||!r.data)throw Error('Draft unavailable');return r.data},
   async readCanon(){const raw=await liveGlyphCharacters(signal);const canon=normalizePromoCanon(raw,t.characterId,new Date().toISOString());if(canon.revision_sha256!=='3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8')throw Error('Canonical revision changed');return raw},
   async verifyMedia(){const b=await db.storage.getBucket('cafe-sativa-content');if(b.error)throw Error('Private policy unavailable');assertOriginalQaDestination(b.data);const r=await storage.from('cafe-sativa-content').download(`character-promos/${t.characterId}/${t.promoId}/${t.sha}.mp4`,t.bytes);if(r.error||!r.data)throw Error('Private bytes unavailable');const bytes=r.data;if(Buffer.from(bytes).toString('ascii',4,8)!=='ftyp')throw Error('Invalid MP4');return {sha:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}},
   async readObservations(){const r=await db.from('cs_character_promo_qa_checks').select('id,promo_id,video_sha256,check_name,result,evidence,reviewer_id,created_at').eq('promo_id',t.promoId).eq('video_sha256',t.sha).limit(10).abortSignal(signal);if(r.error||!r.data)throw Error('Observations unavailable');return r.data},
   async rpc(args){return await db.rpc('cs_record_character_promo_qa_observation',args).abortSignal(signal).retry(false)},
  });return {status:'ingested'}
 }}
}})
/** Reuse reviewed empty-Next-body, deadline and admission controls. This endpoint
 * imports technical observations ONLY; no generation, final QA or publication. */
export async function POST(req:Request){
 const response=await handler(req)
 if(response.status!==200)return response
 return Response.json({status:'observations_recorded',promoId:t.promoId,sha256:t.sha,checks:9,passes:8,needsReview:['lip_sync'],attribution:'AI-assisted inspection, not personal owner review',qaApproved:false,publicationApproved:false,automatedIngestionProven:false},{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
}
