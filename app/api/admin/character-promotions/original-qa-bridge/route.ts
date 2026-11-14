import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from '@/lib/content/character-production-bounded-fetch'
import {createStreamingQaStorage} from '@/lib/content/character-production-qa-storage'
import {createCharacterProductionQaBridge} from '@/lib/content/character-production-qa-bridge'
import {createOriginalQaHandler,originalQaRpc,originalQaTarget,assertOriginalQaDestination} from '@/lib/content/character-production-original-qa'
export const dynamic='force-dynamic'
export const maxDuration=60
export const POST=createOriginalQaHandler({authorize:isContentAdmin,open(signal){
 const network=createProductionFetch(signal),db=createAdminClient(network.fetch)
 const rpc=originalQaRpc({rpc:(name,args)=>db.rpc(name,args).abortSignal(signal).retry(false)},signal)
 const bridge=createCharacterProductionQaBridge(rpc,createStreamingQaStorage(db.storage,15000))
 return {ingest:async()=>{const b=await db.storage.getBucket('cafe-sativa-content');if(b.error)throw Error('QA destination unavailable');assertOriginalQaDestination(b.data);return bridge.ingest(originalQaTarget.key,originalQaTarget.digest)},whenSettled:network.whenSettled}
}})
