import {qaFailureReason,type QaReason} from '@/lib/content/character-production-qa-diagnostics'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from '@/lib/content/character-production-bounded-fetch'
import {createStreamingQaStorage} from '@/lib/content/character-production-qa-storage'
import {createCharacterProductionQaBridge,type QaBridgePhase} from '@/lib/content/character-production-qa-bridge'
import {createOriginalQaHandler,originalQaRpc,originalQaTarget,assertOriginalQaDestination} from '@/lib/content/character-production-original-qa'
export const dynamic='force-dynamic'
export const maxDuration=60
export const POST=createOriginalQaHandler({authorize:isContentAdmin,open(signal){
 const network=createProductionFetch(signal),db=createAdminClient(network.fetch)
 const rpc=originalQaRpc({rpc:(name,args)=>db.rpc(name,args).abortSignal(signal).retry(false)},signal)
 let reason:QaReason|undefined
 let phase:QaBridgePhase|'destination_preflight'='destination_preflight'
 const bridge=createCharacterProductionQaBridge(rpc,createStreamingQaStorage(db.storage,15000),value=>{phase=value})
 return {ingest:async()=>{try{const b=await db.storage.getBucket('cafe-sativa-content');if(b.error)throw Error('QA destination unavailable');assertOriginalQaDestination(b.data);const result=await bridge.ingest(originalQaTarget.key,originalQaTarget.digest);if(result.status==='held')reason='authority_held';if(result.status==='held')console.warn({event:'original_qa_held',phase,reason:'authority_held'});return result}catch(error){reason=signal.aborted?'cancelled':qaFailureReason(error);console.warn({event:'original_qa_held',phase,reason});throw Error('Original QA operation unconfirmed')}},whenSettled:network.whenSettled,diagnostic:()=>({phase,reason})}
}})
