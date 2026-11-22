import 'server-only'
import {performance} from 'node:perf_hooks'
import {isContentAdmin} from './auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {liveGlyphCharacters} from './glyph-live'
import {normalizePromoCanon} from './character-promo-sources'
import {runIncludedSpeechOperation,type IncludedSpeechOperation} from './character-production-included-speech-operation'
import {createIncludedOperationProvider,createIncludedOperationStore} from './character-production-included-speech-operation-io'
import {measureIncludedMp3Duration} from './character-production-speech-duration'
import {createIncludedSpeechHandler} from './character-production-included-speech-handler'
import {liveLavicheCanonicalObservation} from './glyph-laviche-observation'
import {stageLavichePortraitId,stageLavicheSpeech} from './character-production-stage-laviche-policy'
/** Dormant server-only factory. Caller supplies reviewed code-owned finite scope;
 * no request parameters can choose script, voice, canon revision, key or storage. */
export function createFiniteIncludedSpeechHandler(operation:IncludedSpeechOperation){
 const stage=operation.key===stageLavicheSpeech.key
 return createIncludedSpeechHandler(operation,{
  origin:'https://www.cafe-sativa.com',
  deadlineMs:85000, // Leaves cleanup margin below the 90-second Next route ceiling.
  enabled:()=>stage
   ? process.env.CS_STAGE_LAVICHE_SPEECH_ENABLED==='true'
   : process.env.CS_CHARACTER_FINITE_SPEECH_ENABLED==='true',
  authorize:isContentAdmin,
  open(s,signal){
   const started=performance.now()
   const network=createProductionFetch(signal,fetch,3000),db=createAdminClient(network.fetch)
   // Captured once: quota inventory and POST cannot switch accounts mid-operation.
   const key=process.env.ELEVENLABS_API_KEY??''
   const provider=createIncludedOperationProvider(s,key,signal,fetch,()=>{if(signal.aborted||performance.now()-started>30000)throw Error('insufficient_post_time')}),store=createIncludedOperationStore(s,db.storage,signal)
   const canon=async()=>{
    const value=await (stage?liveLavicheCanonicalObservation(signal):liveGlyphCharacters(signal))
    if(signal.aborted)throw Error('cancelled')
    const current=normalizePromoCanon(value,s.characterId,new Date().toISOString())
    if(current.revision_sha256!==s.canonicalRevision||current.primary_asset_id!==(stage?stageLavichePortraitId:'473df9fd-b48c-4f01-a89a-499de631b954')||current.portrait_sha256!==s.portraitSha256||current.voice_id!==s.voiceId||current.rights_status!=='approved'||current.voice_status!=='canonical'||current.production_ready!==true)throw Error('canonical_changed')
   }
   return {async run(){return runIncludedSpeechOperation(s,{signal,now:Date.now,canon,store,quota:provider.quota,synthesize:provider.synthesize,measureDuration:async bytes=>measureIncludedMp3Duration(bytes)})},async whenSettled(){await Promise.all([network.whenSettled(),provider.whenSettled()])}}
  },
 })
}
