import 'server-only'
import {isContentAdmin} from './auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createIncludedOperationStore} from './character-production-included-speech-operation-io'
import {reviewedZariaSpeech} from './character-production-zaria-speech-reviewed'
import {createPrivateSpeechPlayback} from './character-production-private-speech-playback'
export const readPrivateZariaAudio=createPrivateSpeechPlayback(reviewedZariaSpeech,{
 authorize:isContentAdmin,
 open(signal){
  const network=createProductionFetch(signal,fetch,3000),db=createAdminClient(network.fetch)
  return {store:createIncludedOperationStore(reviewedZariaSpeech,db.storage,signal),whenSettled:()=>network.whenSettled()}
 },
})
