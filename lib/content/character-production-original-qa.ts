import type {ProductionRpc} from './character-production-store.ts'
export const originalQaTarget=Object.freeze({
 key:'zaria-gallery-image-canary-20261114',digest:'01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3',
 task:'c8246007ce21cee14e38f409b4492967',sha:'018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658',bytes:4023955,
 promoId:'7edd4058-9184-4411-9a95-bad175e974ea',characterId:'zaria-solenne',
})
export function assertOriginalQaDestination(data:unknown){
 const b=data as {id?:unknown;public?:unknown;file_size_limit?:unknown;allowed_mime_types?:unknown}
 if(!b||b.id!=='cafe-sativa-content'||b.public!==false||b.file_size_limit!==52428800||!Array.isArray(b.allowed_mime_types)||b.allowed_mime_types.length!==1||b.allowed_mime_types[0]!=='video/mp4')throw Error('QA destination policy changed')
}
/** Only this pre-enrolled original job and NEW unapproved draft are reachable. */
export function originalQaRpc(rpc:ProductionRpc,signal:AbortSignal):ProductionRpc {
 const t=originalQaTarget
 return {async rpc(name,args){
  if(signal.aborted||!['character_production_qa_prepare','character_production_qa_commit'].includes(name)||args.p_key!==t.key||args.p_digest!==t.digest)throw Error('QA scope rejected')
  if(name.endsWith('_commit')&&(args.p_sha!==t.sha||args.p_bytes!==t.bytes||args.p_promo_id!==t.promoId||args.p_destination_bucket!=='cafe-sativa-content'||args.p_destination_path!==`character-promos/${t.characterId}/${t.promoId}/${t.sha}.mp4`))throw Error('QA commit identity rejected')
  const r=await rpc.rpc(name,args)
  if(signal.aborted)throw Error('QA cancelled')
  if(name.endsWith('_prepare')&&!r.error&&r.data!==null){const m=r.data as Record<string,unknown>
   if(!m||typeof m!=='object'||m.key!==t.key||m.digest!==t.digest||m.sha!==t.sha||m.bytes!==t.bytes||m.promoId!==t.promoId||m.characterId!==t.characterId)throw Error('QA target not enrolled')
  }
  return r
 }}
}
export function createOriginalQaHandler(d:{authorize():Promise<boolean>;open(signal:AbortSignal):{ingest():Promise<{status:'held'|'ingested'}>;whenSettled():Promise<void>}}){
 let busy=false
 const response=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 return async(req:Request)=>{
  if(req.method!=='POST'||new URL(req.url).search||req.body!==null)return response(405,{status:'unsupported'})
  if(req.headers.get('origin')!==new URL(req.url).origin)return response(403,{status:'forbidden'})
  if(busy)return response(429,{status:'busy'})
  busy=true;const c=new AbortController(),abort=()=>c.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  let deps:ReturnType<typeof d.open>|undefined,authTimer:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setTimeout>|undefined
  const auth=Promise.resolve().then(()=>d.authorize())
  const work=(async()=>{
   if(!await auth||c.signal.aborted)return response(401,{status:'unauthorized'})
   deps=d.open(c.signal)
   const result=await deps.ingest()
   if(c.signal.aborted||result.status!=='ingested')return response(503,{status:'held',approvalGranted:false})
   return response(200,{status:'ingested',promoId:originalQaTarget.promoId,sha256:originalQaTarget.sha,bytes:originalQaTarget.bytes,generated:false,qaApproved:false,publicationApproved:false,deliveryScheduled:false,automaticGenerationVerified:false})
  })()
  // A timed-out auth/transport remains admitted until the original work settles.
  void work.finally(async()=>{try{await deps?.whenSettled()}finally{busy=false}}).catch(()=>{})
  try{return await Promise.race([work,new Promise<Response>(resolve=>{
   authTimer=setTimeout(()=>{c.abort();resolve(response(401,{status:'unauthorized'}))},5000)
   void auth.finally(()=>clearTimeout(authTimer)).catch(()=>{})
   timer=setTimeout(()=>{c.abort();resolve(response(503,{status:'held',approvalGranted:false}))},45000)
  })])}catch{return response(503,{status:'held',approvalGranted:false})}
  finally{clearTimeout(authTimer);clearTimeout(timer);c.abort();req.signal.removeEventListener('abort',abort)}
 }
}
