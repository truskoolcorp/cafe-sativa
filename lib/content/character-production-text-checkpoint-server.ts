import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createTextCheckpointReparser,validateCheckpointIdentity,type TextCheckpointIdentity} from './character-production-text-checkpoint'
/** Internal server operation, not a route. Identity must be supplied by trusted
 * owner-scoped configuration, never arbitrary public request parameters.
 * Reads one historical checkpoint; never calls a paid provider or promotes it. */
export function createTextCheckpointReadOperation(expected:TextCheckpointIdentity){
 const identity=structuredClone(expected);validateCheckpointIdentity(identity)
 let used=false,closing=false,work:Promise<unknown>|undefined,network:ReturnType<typeof createProductionFetch>|undefined
 const enabled=()=>process.env.CS_CHARACTER_TEXT_CHECKPOINT_ENABLED==='true'
 return {async run(parent:AbortSignal){
  if(used||closing||parent.aborted||!enabled())return {status:'disabled' as const}
  used=true;const signal=AbortSignal.any([parent,AbortSignal.timeout(10000)])
  work=(async()=>{
   network=createProductionFetch(signal);const db=createAdminClient(network.fetch)
   return createTextCheckpointReparser({identity,async read(s){
    s.throwIfAborted();if(!enabled())throw Error('checkpoint_unconfirmed')
    const r=await db.rpc('character_production_text_checkpoint_read',{p_key:identity.key,p_token:identity.token,p_digest:identity.sourceDigest}).abortSignal(s).retry(false)
    s.throwIfAborted();if(!enabled()||r.error||!r.data)throw Error('checkpoint_unconfirmed')
    return r.data
   }}).reparse(signal)
  })();return work
 },async whenSettled(){closing=true;const result=await Promise.allSettled(work?[work]:[]);await network?.whenSettled();if(result.some(r=>r.status==='rejected'))throw Error('checkpoint_unconfirmed')}}
}
