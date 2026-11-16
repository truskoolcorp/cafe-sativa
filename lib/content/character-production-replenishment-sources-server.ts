import 'server-only'
import {createClient} from '@supabase/supabase-js'
import {createAdminClient} from '@/lib/supabase/admin'
import {liveGlyphCharacters} from './glyph-live'
import {createProductionFetch} from './character-production-bounded-fetch'
import {cafeBoundedReadFetch} from './character-promo-cafe-read-fetch'
import {createReplenishmentSourceLoader,type ReplenishmentSourceScope} from './character-production-replenishment-sources'
/** Existing read capabilities only. No query/RPC writes, credential refresh,
 * storage upload, authorization widening or paid model call. No route installed. */
export function openReplenishmentSources(scope:ReplenishmentSourceScope,signal:AbortSignal){
 const network=createProductionFetch(signal),fetcher=cafeBoundedReadFetch(network.fetch)
 const origin=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 if(scope.topic==='public-event'&&(!origin||!key))throw Error('Existing anonymous public source unavailable')
 const publicDb=scope.topic==='public-event'?createClient(origin!,key!,{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):undefined
 const db=createAdminClient(fetcher)
 const read=createReplenishmentSourceLoader(scope,{db,publicDb,readGlyph:liveGlyphCharacters,now:Date.now,signal})
 const active=new Set<Promise<unknown>>();let closing=false
 return {
  load(){
   if(closing||signal.aborted)return Promise.reject(Error('Source reader closed'))
   const work=Promise.resolve().then(()=>{signal.throwIfAborted();return read()});active.add(work)
   void work.then(()=>active.delete(work),()=>active.delete(work));return work
  },
  async whenSettled(){
   closing=true
   const results=await Promise.allSettled([...active])
   // Includes database calls started after a slow GLYPH read. Never claim the
   // network-only tracker also tracks GLYPH's independent global fetch.
   const networkResult=await Promise.allSettled([network.whenSettled()])
   if([...results,...networkResult].some(r=>r.status==='rejected'))throw Error('Source read failed after settlement')
  },
 }
}
