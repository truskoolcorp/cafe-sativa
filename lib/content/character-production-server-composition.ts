import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {liveGlyphCharacters} from './glyph-live'
import {normalizePromoCanon} from './character-promo-sources'
import {createProductionFetch,createProductionProviderFetch} from './character-production-bounded-fetch'
import {createPrivateRenderedAudioSource} from './character-production-private-audio'
import {createCanonicalImageRuntimeProvider} from './character-production-image-composition'
import {createPrivateCanonicalImageSource} from './character-production-private-image'
import type {CanonicalImageBinding} from './character-production-canonical-image'
import type {CharacterProductionRuntimeConfig} from './character-production-runtime'
import {createServerProductionRpc} from './character-production-server-rpc'
import {restrictProductionRpc} from './character-production-exact-scope'
import type {ExactProductionScope} from './character-production-exact-scope'
import type {InternalProductionDependencies} from './character-production-internal-worker'

/** Reviewed code manifest, not request input or arbitrary environment JSON.
 * It cannot authorize a job: exact durable slot and budget still govern every
 * submission. Existing deployed secrets are used in place, never copied. */
export type InternalProductionManifest={
 configuration:CharacterProductionRuntimeConfig;
 expectedHeyGenUsername:string;
 images:readonly CanonicalImageBinding[];
 exactScope?:ExactProductionScope;
}
export function openInternalProduction(manifest:InternalProductionManifest,signal:AbortSignal):InternalProductionDependencies&{whenSettled():Promise<void>}{
 if(signal.aborted)throw Error('Cancelled production tick')
 const network=createProductionFetch(signal)
 const phases=manifest.configuration.heygen.phases
 const providerNetwork=createProductionProviderFetch(signal,fetch,phases?Math.max(phases.submitMs,phases.statusMs):8000)
 const db=createAdminClient(network.fetch)
 const origin=process.env.NEXT_PUBLIC_SUPABASE_URL
 if(!origin)throw Error('Existing storage unavailable')
 const audio=createPrivateRenderedAudioSource(db.storage,origin,manifest.images.map(p=>p.audio))
 const images=createPrivateCanonicalImageSource(db.storage,origin,manifest.images)
 const provider=createCanonicalImageRuntimeProvider(manifest.configuration.heygen,manifest.expectedHeyGenUsername,
  ()=>process.env.HEYGEN_API_KEY,manifest.images,images,audio,providerNetwork.fetch)
 const rpc=createServerProductionRpc(db,signal)
 return {rpc:manifest.exactScope?restrictProductionRpc(rpc,manifest.exactScope):rpc,storage:db.storage,...provider,
  readCanon:async innerSignal=>{
   if(signal.aborted)throw Error('Cancelled canonical read')
   // The existing reader owns its fixed host and credential. Combine its local
   // validation deadline with the worker deadline, without a new auth surface.
   const c=new AbortController(),abort=()=>c.abort()
   signal.addEventListener('abort',abort,{once:true});innerSignal.addEventListener('abort',abort,{once:true})
   if(signal.aborted||innerSignal.aborted)c.abort()
   try{return await liveGlyphCharacters(c.signal)}finally{c.abort();signal.removeEventListener('abort',abort);innerSignal.removeEventListener('abort',abort)}
  },
  normalizeCanon:normalizePromoCanon,
  async whenSettled(){await Promise.all([network.whenSettled(),providerNetwork.whenSettled(),audio.whenSettled(),images.whenSettled()])},
 }
}
