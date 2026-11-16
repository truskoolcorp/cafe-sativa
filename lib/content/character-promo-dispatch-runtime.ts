import 'server-only'
import {assertNoKnownExternalPromo} from './character-promo-known-external'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { liveGlyphCharacters } from './glyph-live'
import { unseal } from './metricool-oauth'
import { metricoolSession } from './metricool-mcp'
import { readPromoMetricoolBrands } from './character-promo-metricool-readonly'
import { openCharacterPromoDispatchSession } from './character-promo-dispatch-connection'
import { readApprovedCharacterPromo } from './character-promo-sources'
import { readVerifiedPromoBytes } from './character-promo-material'
import { characterPromoMetricoolSubmit, readCharacterPromoProviderMedia } from './character-promo-metricool'
import { dispatchCharacterPromo } from './character-promo-dispatch'
import { createPromoDispatchHandler } from './character-promo-dispatch-http'
export const personaDispatchRuntimeEnabled=()=>process.env.CS_PERSONA_REVIEW_RUNTIME_ENABLED==='true'&&process.env.CS_PERSONA_DISPATCH_ENABLED==='true'
export function verifyPromoDispatchTools(tools:unknown) {
 if(!Array.isArray(tools))throw Error('Provider tool inventory unavailable')
 for(const name of ['getBrandSettings','getScheduledPosts','createScheduledPost'])if(tools.filter(t=>t&&typeof t.name==='string'&&t.name.replace(/_/g,'').toLowerCase()===name.toLowerCase()).length!==1)throw Error('Provider tool identity missing or ambiguous')
}
/** No clients, credentials, reads or provider activity until an enabled explicit request. */
export function personaDispatchHandler() {
 let db:ReturnType<typeof createAdminClient>|undefined
 const database=()=>db||(db=createAdminClient())
 const auth=()=>createClient().auth
 const connectionDeps=()=>({db:database(),decrypt:(v:string)=>unseal(v,'credentials'),openSession:async(token:string)=>{const session=await metricoolSession(token);verifyPromoDispatchTools(session.tools);return session},now:Date.now})
 return createPromoDispatchHandler({
  enabled:personaDispatchRuntimeEnabled,
  authorize:async()=>{const r=await auth().getUser();return !r.error&&r.data.user?.app_metadata?.cafe_sativa_admin===true},
  dispatch:async input=>{
   const storageOrigin=process.env.NEXT_PUBLIC_SUPABASE_URL||''
   try {const u=new URL(storageOrigin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/')throw Error('Invalid storage origin')}catch{return {status:'blocked',publicationConfirmed:false,reason:'Approved storage origin unavailable; no submission started.'}}
   return dispatchCharacterPromo(input,{
    auth:auth(),rpc:(name,args)=>database().rpc(name,args),now:Date.now,
    readCurrent:async planId=>{
     const current=await readApprovedCharacterPromo(planId,{db:database(),now:Date.now,readGlyph:liveGlyphCharacters,readMetricoolBrands:()=>readPromoMetricoolBrands(connectionDeps())})
     assertNoKnownExternalPromo(current.approval.snapshot)
     return current
    },
    makeSubmit:ownerPreflight=>async(snapshot,bytes,revalidate)=>{
     assertNoKnownExternalPromo(snapshot)
     let session:Awaited<ReturnType<typeof openCharacterPromoDispatchSession>>|null=null
     const submit=characterPromoMetricoolSubmit({
      now:Date.now,storageOrigin,
      openSession:async()=>{session=await openCharacterPromoDispatchSession(connectionDeps());return session},
      preflightExternalWrite:async()=>{assertNoKnownExternalPromo(snapshot);await ownerPreflight();if(!session)throw Error('Verified dispatch session unavailable');await session.preflight()},
      bucket:{
       download:async path=>{
        if(path!==snapshot.videoPath)throw Error('Unapproved private media path')
        const verified=await readVerifiedPromoBytes(database(),snapshot.promoId,snapshot.videoSha256)
        return {data:{arrayBuffer:async()=>Uint8Array.from(verified.bytes).buffer},error:null}
       },
       createSignedUrl:async(path,seconds)=>{
        if(path!==snapshot.videoPath||seconds!==3600)throw Error('Unapproved private media handoff')
        return database().storage.from('cafe-sativa-content').createSignedUrl(path,seconds)
       },
      },
      readProviderMedia:readCharacterPromoProviderMedia,
     })
     return submit(snapshot,bytes,revalidate)
    },
   },{enabled:personaDispatchRuntimeEnabled()})
  },
 })
}
