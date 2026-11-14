import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from '@/lib/content/character-production-bounded-fetch'
import {createPrivateOutputStorage} from '@/lib/content/character-production-broker-boundary'
import {createOriginalRecoveryHandler} from '@/lib/content/character-production-original-recovery'
export const dynamic='force-dynamic'
export const maxDuration=60
export const POST=createOriginalRecoveryHandler({authorize:isContentAdmin,open(signal){
 const network=createProductionFetch(signal),db=createAdminClient(network.fetch)
 return {storage:createPrivateOutputStorage(db.storage,15000),whenSettled:network.whenSettled,
 async read(){const r=await db.rpc('character_production_original_recovery_job').abortSignal(signal).retry(false);if(r.error)throw Error('Recovery read unavailable');return r.data},
 async commit(job){const r=await db.rpc('character_production_original_recovery_commit',{p_job:job}).abortSignal(signal).retry(false);return !r.error&&r.data===true}}
}})
