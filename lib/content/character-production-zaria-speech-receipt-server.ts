import 'server-only'
import {isContentAdmin} from './auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createIncludedOperationStore} from './character-production-included-speech-operation-io'
import {createSpeechProbeHandler} from './character-production-speech-probe-handler'
import {reviewedZariaSpeech} from './character-production-zaria-speech-reviewed'
import {verifyIncludedSpeechReceipt} from './character-production-speech-receipt'
const readAuthorized=createSpeechProbeHandler({
 authorize:isContentAdmin,enabled:()=>false,attempt:()=>undefined,
 open(_mode,signal){
  const network=createProductionFetch(signal,fetch,3000),db=createAdminClient(network.fetch)
  const store=createIncludedOperationStore(reviewedZariaSpeech,db.storage,signal)
  return {run:()=>verifyIncludedSpeechReceipt(reviewedZariaSpeech,store,signal),whenSettled:network.whenSettled}
 },
})
export const readZariaSpeechReceipt=(req:Request)=>req.method==='GET'?readAuthorized(req):Promise.resolve(Response.json({status:'unsupported'},{status:405,headers:{'Cache-Control':'private, no-store'}}))
