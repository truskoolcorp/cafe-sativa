import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {isContentAdmin} from './auth'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createFiniteIncludedSpeechHandler} from './character-production-included-speech-server'
import {createIncludedOperationProvider,createIncludedOperationStore} from './character-production-included-speech-operation-io'
import {createPrivateSpeechPlayback} from './character-production-private-speech-playback'
import {createSpeechProbeHandler} from './character-production-speech-probe-handler'
import {normalizePromoCanon} from './character-promo-sources'
import {stageLavichePortraitId,stageLavicheScope,stageLavicheSpeech} from './character-production-stage-laviche-policy'
import {liveLavicheCanonicalObservation} from './glyph-laviche-observation'

const configured=stageLavicheScope(process.env.CS_STAGE_LAVICHE_SPEECH_CANON_REVISION)
const unavailable=()=>Response.json({status:'not_configured'},{status:503,headers:{'Cache-Control':'private, no-store'}})
export const renderStageLavicheSpeech=configured?createFiniteIncludedSpeechHandler(configured):unavailable

/** Read-only same-account provider check. This cannot reserve or submit a take. */
const preflight=createSpeechProbeHandler({
 authorize:isContentAdmin,enabled:()=>false,attempt:()=>undefined,
 open(_mode,signal){
  const network=createProductionFetch(signal,fetch,3000)
  let waitForProvider: (()=>Promise<void>)|undefined
  return {
   async run(){
    const observed=await liveLavicheCanonicalObservation(signal)
    const {verifiedAt} = observed as {verifiedAt?: unknown}
    if(typeof verifiedAt!=='string')throw Error('canonical_unconfirmed')
    const canon=normalizePromoCanon(observed,stageLavicheSpeech.characterId,verifiedAt)
    if(canon.primary_asset_id!==stageLavichePortraitId||canon.portrait_sha256!==stageLavicheSpeech.portraitSha256||canon.voice_id!==stageLavicheSpeech.voiceId)throw Error('canonical_changed')
    const candidate=stageLavicheScope(canon.revision_sha256)
    if(!candidate)throw Error('canonical_unconfirmed')
    signal.throwIfAborted()
    const provider=createIncludedOperationProvider(candidate,process.env.ELEVENLABS_API_KEY??'',signal)
    waitForProvider=provider.whenSettled
    const db=createAdminClient(network.fetch)
    const store=createIncludedOperationStore(candidate,db.storage,signal)
    const [observation,,prior]=await Promise.all([
     provider.inspect(),store.preflight(),
     db.storage.from('cafe-sativa-characters').list(`production-speech-operations/${stageLavicheSpeech.key}`,{limit:1}),
    ])
    signal.throwIfAborted()
    if(prior.error||!Array.isArray(prior.data))throw Error('operation_history_unconfirmed')
    const unused=prior.data.length===0
    return {
     status:unused?'read_only_preflight':'reconcile_existing_operation',
     operationUnused:unused,canonicalRevision:canon.revision_sha256,
     pinnedRevisionMatches:configured?.canonicalRevision===canon.revision_sha256,
     scopeActive:Date.now()<stageLavicheSpeech.expiresAt,
     armed:process.env.CS_STAGE_LAVICHE_SPEECH_ENABLED==='true',
     includedQuotaReady:observation.ready, quotaReason:observation.reason,
     storagePolicyVerified:true, synthesisAttempted:false,
    }
   },
   async whenSettled(){await Promise.all([network.whenSettled(),waitForProvider?.()])},
  }
 },
})
export const verifyStageLavicheSpeech=(request:Request)=>request.method==='GET'?preflight(request):unavailable()

export const readStageLavicheAudio=configured?createPrivateSpeechPlayback(configured,{
 authorize:isContentAdmin,
 open(signal){
  const network=createProductionFetch(signal,fetch,3000),db=createAdminClient(network.fetch)
  return {store:createIncludedOperationStore(configured,db.storage,signal),whenSettled:network.whenSettled}
 },
}):unavailable
