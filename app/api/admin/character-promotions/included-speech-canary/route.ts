import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from '@/lib/content/character-production-bounded-fetch'
import {createOriginalQaHandler} from '@/lib/content/character-production-original-qa'
import {liveGlyphCharacters} from '@/lib/content/glyph-live'
import {normalizePromoCanon} from '@/lib/content/character-promo-sources'
import {validateZariaCanon} from '@/lib/content/zaria-original-observation-import'
import {runIncludedCanary} from '@/lib/content/character-production-included-canary'
import {createIncludedProvider,createIncludedStore} from '@/lib/content/character-production-included-canary-io'
export const dynamic='force-dynamic'
export const maxDuration=60
// Deployment alone never authorizes the paid/included-resource request.
const ENABLED=false
const handler=createOriginalQaHandler({authorize:isContentAdmin,open(signal){
 const network=createProductionFetch(signal,fetch,3000),db=createAdminClient(network.fetch)
 const provider=createIncludedProvider(process.env.ELEVENLABS_API_KEY??'',signal),store=createIncludedStore(db.storage,signal)
 return {whenSettled:async()=>{await Promise.all([network.whenSettled(),provider.whenSettled()])},async ingest(){await runIncludedCanary({signal,now:Date.now,store,...provider,async canon(){const value=await liveGlyphCharacters(signal);validateZariaCanon(value);if(normalizePromoCanon(value,'zaria-solenne',new Date().toISOString()).revision_sha256!=='3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8')throw Error('canonical_changed')}});return {status:'ingested'}}}
}})
export async function POST(req:Request){
 if(!ENABLED)return Response.json({status:'disabled',synthesisAttempted:false},{status:503,headers:{'Cache-Control':'private, no-store'}})
 const r=await handler(req);if(r.status!==200)return r
 return Response.json({status:'private_pending_qa',providerReceiptConfirmed:true,qaApproved:false,publicationApproved:false},{headers:{'Cache-Control':'private, no-store'}})
}

/** Read-only provider prerequisites; no Storage claim or synthesis, even if ready. */
let inspecting=false
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'}
 if(new URL(req.url).search)return Response.json({status:'unsupported'},{status:400,headers})
 if(inspecting)return Response.json({status:'busy'},{status:429,headers})
 inspecting=true
 const controller=new AbortController(),abort=()=>controller.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
 let provider:ReturnType<typeof createIncludedProvider>|undefined,authTimer:ReturnType<typeof setTimeout>|undefined,totalTimer:ReturnType<typeof setTimeout>|undefined
 const auth=Promise.resolve().then(()=>isContentAdmin())
 const task=(async()=>{if(!await auth||controller.signal.aborted)return Response.json({status:'unauthorized'},{status:401,headers});provider=createIncludedProvider(process.env.ELEVENLABS_API_KEY??'',controller.signal);const result=await provider.inspect();if(controller.signal.aborted)throw Error('cancelled');return Response.json({...result,canaryEnabled:ENABLED},{headers})})()
 void task.finally(async()=>{try{await provider?.whenSettled()}finally{inspecting=false}}).catch(()=>{})
 try{return await Promise.race([task,new Promise<Response>(resolve=>{authTimer=setTimeout(()=>{controller.abort();resolve(Response.json({status:'unauthorized'},{status:401,headers}))},5000);void auth.finally(()=>clearTimeout(authTimer)).catch(()=>{});totalTimer=setTimeout(()=>{controller.abort();resolve(Response.json({status:'preflight_unconfirmed',synthesisAttempted:false},{status:503,headers}))},18000)})])}catch{return Response.json({status:'preflight_unconfirmed',synthesisAttempted:false,canaryEnabled:ENABLED},{status:503,headers})}finally{clearTimeout(authTimer);clearTimeout(totalTimer);controller.abort();req.signal.removeEventListener('abort',abort)}
}
