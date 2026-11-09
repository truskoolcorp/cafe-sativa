export type PromoHttpDependencies={
 enabled():boolean
 authorize():Promise<boolean>
 view(planId:string):Promise<unknown>
 preview(promoId:string,sha256:string):Promise<{bytes:Uint8Array}>
 action(body:Record<string,unknown>):Promise<unknown>
}
const HEADERS={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie','Cross-Origin-Resource-Policy':'same-origin'}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SHA=/^[a-f0-9]{64}$/
const QA=['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety']
const RESULTS=['pass','fail','needs_review']
const timestamp=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
function observationValid(v:unknown) {
 if(!v||typeof v!=='object'||Array.isArray(v))return false
 const q=v as Record<string,unknown>
 const keys=['id','promo_id','video_sha256','check_name','result','evidence','reviewer_id','created_at']
 return Object.keys(q).length===keys.length&&keys.every(k=>k in q)&&['id','promo_id'].every(k=>typeof q[k]==='string'&&UUID.test(q[k] as string))&&(q.reviewer_id===null||(typeof q.reviewer_id==='string'&&UUID.test(q.reviewer_id)))&&typeof q.video_sha256==='string'&&SHA.test(q.video_sha256)&&QA.includes(q.check_name as string)&&RESULTS.includes(q.result as string)&&typeof q.evidence==='string'&&Array.from(q.evidence).length<=1000&&timestamp(q.created_at)
}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:HEADERS})
class HttpFault extends Error {constructor(readonly status:number,readonly code:string,message:string){super(message)}}
function failure(error:unknown) {
 if(error instanceof HttpFault)return reply({error:error.message,code:error.code},error.status)
 return reply({error:'Review is unavailable or the result is unconfirmed. Reload before any retry.',code:'review_unavailable'},503)
}
async function input(req:Request):Promise<Record<string,unknown>> {
 if(req.headers.get('origin')!==new URL(req.url).origin || req.headers.get('sec-fetch-site')==='cross-site')throw new HttpFault(403,'origin_rejected','Same-origin explicit review action required')
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new HttpFault(415,'json_required','JSON review action required')
 const max=65536,declared=req.headers.get('content-length')
 if(declared && (!/^\d+$/.test(declared)||Number(declared)>max))throw new HttpFault(413,'request_too_large','Review action exceeds the supported size')
 if(!req.body)throw new HttpFault(400,'body_missing','Review action body required')
 const reader=req.body.getReader(),chunks:Uint8Array[]=[];let total=0
 for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>max){await reader.cancel();throw new HttpFault(413,'request_too_large','Review action exceeds the supported size')}chunks.push(part.value)}
 let value:unknown
 try {value=JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))}catch{throw new HttpFault(400,'invalid_json','Invalid review action JSON')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpFault(400,'invalid_action','Explicit review action required')
 return value as Record<string,unknown>
}
/** All mutations are explicit user actions; there is deliberately no dispatch operation. */
export function createPromoHttpHandlers(deps:PromoHttpDependencies) {
 const gate=async()=>{
  if(!deps.enabled())return reply({error:'Persona review runtime is disabled pending approved rollout.',code:'review_runtime_disabled'},503)
  try {if(!await deps.authorize())return reply({error:'Unauthorized'},401)}catch{return reply({error:'Unauthorized'},401)}
  return null
 }
 return {
  async GET(req:Request) {
   const blocked=await gate();if(blocked)return blocked
   try {const id=new URL(req.url).searchParams.get('planId')||'';if(!UUID.test(id))throw new HttpFault(400,'plan_id_invalid','Valid plan UUID required');return reply(await deps.view(id))}catch(e){return failure(e)}
  },
  async MEDIA(req:Request) {
   const blocked=await gate();if(blocked)return blocked
   try {
    const url=new URL(req.url),id=url.searchParams.get('promoId')||'',sha=url.searchParams.get('sha256')||''
    if(!UUID.test(id)||!SHA.test(sha))throw new HttpFault(400,'media_identity_invalid','Exact promo UUID and video SHA-256 required')
    const {bytes}=await deps.preview(id,sha)
    const headers={...HEADERS,'Content-Type':'video/mp4','Accept-Ranges':'bytes'}
    const range=req.headers.get('range')
    if(!range)return new Response(Uint8Array.from(bytes).buffer,{headers:{...headers,'Content-Length':String(bytes.length)}})
    const m=range.match(/^bytes=(\d+)-(\d*)$/)
    if(!m)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${bytes.length}`}})
    const start=Number(m[1]),end=m[2]?Number(m[2]):bytes.length-1
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=bytes.length||end>=bytes.length)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${bytes.length}`}})
    return new Response(bytes.slice(start,end+1),{status:206,headers:{...headers,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${bytes.length}`}})
   }catch(e){return failure(e)}
  },
  async POST(req:Request) {
   const blocked=await gate();if(blocked)return blocked
   try {
    const b=await input(req)
    if(typeof b.action!=='string'||b.explicitConfirmation!==true)throw new HttpFault(400,'explicit_action_required','Explicit named action required')
    const fields:Record<string,string[]>={begin_review:['planId','contentDigest','reviewedStateDigest'],replace_review:['planId','contentDigest','reviewedStateDigest'],voice:['planId','contentDigest','reviewedStateDigest'],video:['planId','contentDigest','reviewedStateDigest'],publication:['planId','contentDigest','reviewedStateDigest'],delivery_approval:['planId','reviewedDigest'],review_plan_edit:['planId','caption','scheduledAt'],save_plan_edit:['review'],review_plan_control:['planId','controlAction'],save_plan_control:['review'],reconcile_plan_control:['reviewId'],record_qa:['promoId','videoSha256','draftRevision','checkName','result','evidence','expectedObservation']}
    const allowed=fields[b.action]
    if(!allowed||Object.keys(b).some(k=>!['action','explicitConfirmation',...allowed].includes(k))||allowed.some(k=>!(k in b)))throw new HttpFault(400,'invalid_action','Action fields are invalid; destination and actor cannot be supplied')
    if('planId' in b && (typeof b.planId!=='string'||!UUID.test(b.planId)))throw new HttpFault(400,'plan_id_invalid','Valid plan UUID required')
    for(const k of ['contentDigest','reviewedStateDigest','reviewedDigest'])if(k in b && (typeof b[k]!=='string'||!SHA.test(b[k] as string)))throw new HttpFault(400,'review_digest_invalid','Exact displayed review digest required')
    if(b.action==='review_plan_edit' && (typeof b.caption!=='string'||!b.caption.trim()||Array.from(b.caption).length>500||typeof b.scheduledAt!=='string'||!Number.isFinite(Date.parse(b.scheduledAt))||new Date(b.scheduledAt).toISOString()!==b.scheduledAt))throw new HttpFault(400,'plan_changes_invalid','Exact caption and canonical UTC schedule required')
    if(b.action==='review_plan_control'&&!['withdraw','restore'].includes(b.controlAction as string))throw new HttpFault(400,'control_action_invalid','Explicit withdrawal or restoration required')
    if(b.action==='reconcile_plan_control'&&(typeof b.reviewId!=='string'||!UUID.test(b.reviewId)))throw new HttpFault(400,'review_id_invalid','Exact prior action review ID required')
    if((b.action==='save_plan_control'||b.action==='save_plan_edit') && (!b.review||typeof b.review!=='object'||Array.isArray(b.review)))throw new HttpFault(400,'plan_review_invalid','Exact previously reviewed change is required')
    if(b.action==='record_qa') {
     if(typeof b.promoId!=='string'||!UUID.test(b.promoId)||typeof b.videoSha256!=='string'||!SHA.test(b.videoSha256)||!timestamp(b.draftRevision)||!QA.includes(b.checkName as string)||!RESULTS.includes(b.result as string)||typeof b.evidence!=='string'||!b.evidence.trim()||Array.from(b.evidence).length>1000||(b.expectedObservation!==null&&!observationValid(b.expectedObservation)))throw new HttpFault(400,'qa_observation_invalid','Exact viewed media, revision, prior observation, explicit result and written evidence required')
     const prior=b.expectedObservation as Record<string,unknown>|null
     if(prior&&(prior.promo_id!==b.promoId||prior.video_sha256!==b.videoSha256||prior.check_name!==b.checkName))throw new HttpFault(400,'qa_observation_invalid','Prior observation must match the reviewed media and check')
    }
    return reply(await deps.action(b))
   }catch(e){return failure(e)}
  },
 }
}
