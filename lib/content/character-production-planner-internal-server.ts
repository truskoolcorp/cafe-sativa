import 'server-only'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
import {createAdminClient} from '@/lib/supabase/admin'
import {liveGlyphCharacters} from './glyph-live'
import {normalizePromoCanon} from './character-promo-sources'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createPrivateCanonicalImageSource} from './character-production-private-image'
import {createPrivateRenderedAudioSource} from './character-production-private-audio'
import {createDirectHeyGenApi} from './character-production-heygen-direct'
import {createTrustedPlannerComposition,type TrustedPlannerManifest} from './character-production-planner-trusted-composition'
/** Dormant server-only factory. resolveActor must use a reviewed authenticated
 * server identity flow. No implicit service identity and no request UUID accepted.
 * The existing service client is storage-only here. Planner RPC needs a separately
 * reviewed narrow client capability; absence fails closed with no fallback.
 */
export function createInternalPlanner(manifest:TrustedPlannerManifest,resolveActor:(signal:AbortSignal)=>Promise<string|null>,openPlannerClient:(signal:AbortSignal)=>ProductionServerRpcClient|null){
 const reviewed=structuredClone(manifest),actor=resolveActor,openRestricted=openPlannerClient
 return createTrustedPlannerComposition(reviewed,Date.now,signal=>{
  if(signal.aborted)throw Error('Cancelled planner')
  const plannerDb=openRestricted(signal)
  if(!plannerDb)throw Error('Reviewed narrow planner capability unavailable')
  const network=createProductionFetch(signal),storageDb=createAdminClient(network.fetch)
  const origin=process.env.NEXT_PUBLIC_SUPABASE_URL
  if(!origin)throw Error('Existing storage unavailable')
  const proofs=reviewed.images.map(m=>m.image)
  const images=createPrivateCanonicalImageSource(storageDb.storage,origin,proofs)
  const audio=createPrivateRenderedAudioSource(storageDb.storage,origin,proofs.map(p=>p.audio))
  const api=createDirectHeyGenApi(()=>process.env.HEYGEN_API_KEY,network.fetch,8000,8000)
  return {db:plannerDb,images,audio,readAccount:api.account,resolveActor:actor,normalizeCanon:normalizePromoCanon,
   readCanon:async inner=>{
    const c=new AbortController(),abort=()=>c.abort()
    signal.addEventListener('abort',abort,{once:true});inner.addEventListener('abort',abort,{once:true})
    if(signal.aborted||inner.aborted)c.abort()
    try{return await liveGlyphCharacters(c.signal)}finally{c.abort();signal.removeEventListener('abort',abort);inner.removeEventListener('abort',abort)}
   },
  }
 })
}
