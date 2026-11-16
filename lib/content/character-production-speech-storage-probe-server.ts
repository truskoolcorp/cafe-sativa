import 'server-only'
import {isContentAdmin} from './auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {probeSpeechClaimStorage,reconcileSpeechClaimStorage} from './character-production-speech-storage-probe'
import {createSpeechProbeHandler} from './character-production-speech-probe-handler'
import {liveGlyphCharacters} from './glyph-live'
import {normalizePromoCanon} from './character-promo-sources'
/** Protected provider-free probe only. Never opens ElevenLabs or reads its key. */
export const runAuthorizedSpeechStorageProbe=createSpeechProbeHandler({
 authorize:isContentAdmin,
 enabled:()=>process.env.CS_CHARACTER_SPEECH_STORAGE_PROBE_ENABLED==='true',
 attempt:()=>({id:process.env.CS_CHARACTER_SPEECH_STORAGE_PROBE_ATTEMPT_ID??'',expiresAt:process.env.CS_CHARACTER_SPEECH_STORAGE_PROBE_EXPIRES_AT??''}),
 open(mode,signal,attempt){
  if(mode==='canon')return {async run(){const source=await liveGlyphCharacters(signal);if(signal.aborted)throw Error('cancelled');const c=normalizePromoCanon(source,'zaria-solenne',new Date().toISOString());return {status:'observed',characterId:c.character_id,canonicalRevision:c.revision_sha256,portraitAssetId:c.primary_asset_id,portraitSha256:c.portrait_sha256,voiceId:c.voice_id,rightsStatus:c.rights_status,voiceStatus:c.voice_status,productionReady:c.production_ready,observedAt:c.checked_at,synthesisAttempted:false}},async whenSettled(){}}
  const network=createProductionFetch(signal,fetch,3000),db=createAdminClient(network.fetch);let markerPath:string|undefined
  return {run:()=>probeSpeechClaimStorage(db.storage,signal,attempt!.id,path=>{markerPath=path}),whenSettled:network.whenSettled,reconciliation:()=>({bucket:'cafe-sativa-characters',path:markerPath})}
 },
})


/** Separate GET-only recovery; fixed server attempt, even after write expiry.
 * Existing canon GET above is unchanged. Never enables or retries the probe. */
const reconcileAuthorized=createSpeechProbeHandler({
 authorize:isContentAdmin,enabled:()=>false,attempt:()=>undefined,
 open(_mode,signal){
  const attemptId=process.env.CS_CHARACTER_SPEECH_STORAGE_PROBE_ATTEMPT_ID??''
  const network=createProductionFetch(signal,fetch,3000),db=createAdminClient(network.fetch)
  return {run:()=>reconcileSpeechClaimStorage(db.storage,signal,attemptId),whenSettled:network.whenSettled}
 },
})
export const runAuthorizedSpeechStorageReconciliation=(req:Request)=>req.method==='GET'?reconcileAuthorized(req):Promise.resolve(Response.json({status:'unsupported'},{status:405,headers:{'Cache-Control':'private, no-store'}}))
