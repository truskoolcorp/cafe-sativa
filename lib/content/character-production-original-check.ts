import {createHash} from 'node:crypto'
import type {Collection} from './character-production-engine.ts'
export const originalCheck={task:'c8246007ce21cee14e38f409b4492967',binding:'a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0',digest:'01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3',sha:'018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658',bytes:4023955,expiresAt:Date.parse('2026-11-14T22:00:00Z')} as const
export type CheckPhase='initializing'|'status'|'download'|'private_metadata'|'private_read'|'compare'
export type StatusShape={dataObject:boolean;idPresent:boolean;videoIdPresent:boolean;exactId:boolean;status:'pending'|'processing'|'completed'|'failed'|'other';videoUrlPresent:boolean;errorPresent:boolean}
export function safeStatusShape(raw:unknown):StatusShape{const r=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};const d=r.data&&typeof r.data==='object'&&!Array.isArray(r.data)?r.data as Record<string,unknown>:{};return {dataObject:!!r.data&&typeof r.data==='object'&&!Array.isArray(r.data),idPresent:typeof d.id==='string',videoIdPresent:typeof d.video_id==='string',exactId:d.id===originalCheck.task||d.video_id===originalCheck.task,status:['pending','processing','completed','failed'].includes(String(d.status))?d.status as StatusShape['status']:'other',videoUrlPresent:typeof d.video_url==='string',errorPresent:r.error!==undefined&&r.error!==null||!!d.error_code||!!d.error_message}}
function failureCode(error:unknown){const m=error instanceof Error?error.message:'';return ({'diagnostic_deadline':'deadline','HeyGen API key unavailable':'credential_unavailable','Provider deadline exceeded':'provider_deadline','HeyGen request unconfirmed':'provider_deadline','Production request unconfirmed':'transport_deadline','Private output unavailable':'private_read','Invalid video identity':'status_identity','Invalid completed video':'status_shape','Invalid HeyGen API object':'status_envelope','HeyGen API error':'provider_error','HeyGen API request unavailable':'provider_http','Provider binding revision mismatch':'binding_mismatch','Invalid verified media origin':'origin_config','Untrusted media location':'media_origin','Media status rejected (redirects prohibited)':'media_http','provider mismatch':'provider_bytes','private bucket required':'private_metadata','storage mismatch':'private_bytes'} as Record<string,string>)[m]??'unclassified'}
interface ReadDependencies{collect(task:string,binding:string):Promise<Collection>;privateBucket():Promise<boolean>;read(path:string,max:number):Promise<Uint8Array>;whenSettled():Promise<void>}
/** No production engine, claim, insert, RPC write or provider creation dependency. */
export function createOriginalCollectionCheck(d:{authorize():Promise<boolean>;open(signal:AbortSignal,progress:(phase:CheckPhase,shape?:StatusShape)=>void):ReadDependencies;now?:()=>number}){
 const now=d.now??Date.now;let busy=false,authBusy=false,lastStarted=0
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 return async(req:Request)=>{
  if(req.method!=='GET'||new URL(req.url).search)return reply(405,{status:'unsupported'})
  if(authBusy)return reply(429,{status:'busy'})
  authBusy=true;let authTimer:ReturnType<typeof setTimeout>|undefined
  const auth=Promise.resolve().then(()=>d.authorize())
  void auth.finally(()=>{authBusy=false}).catch(()=>{})
  try{if(await Promise.race([auth,new Promise<boolean>(resolve=>{authTimer=setTimeout(()=>resolve(false),5000)})])!==true)return reply(401,{status:'unauthorized'})}catch{return reply(401,{status:'unauthorized'})}finally{clearTimeout(authTimer)}
  if(now()>=originalCheck.expiresAt)return reply(410,{status:'expired'})
  if(busy||now()-lastStarted<30000)return reply(429,{status:'busy'})
  busy=true;lastStarted=now();const c=new AbortController(),abort=()=>c.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  let deps:ReadDependencies|undefined,phase:CheckPhase='initializing',shape:StatusShape|undefined
  const started=performance.now(), timings:Partial<Record<CheckPhase,number>>={}
  const progress=(next:CheckPhase,s?:StatusShape)=>{phase=next;timings[next]=Math.round(performance.now()-started);if(s)shape=s}
  const held=(error:unknown)=>reply(503,{status:'held',phase,failure:failureCode(error),elapsedMs:Math.round(performance.now()-started),timings,...(shape?{statusShape:shape}:{})})
  const task=(async()=>{
   if(c.signal.aborted)throw Error('cancelled')
   deps=d.open(c.signal,progress)
   const result=await deps.collect(originalCheck.task,originalCheck.binding)
   const valid=(b:Uint8Array)=>b instanceof Uint8Array&&b.length===originalCheck.bytes&&createHash('sha256').update(b).digest('hex')===originalCheck.sha
   if(c.signal.aborted||result.state!=='completed'||result.mime!=='video/mp4'||!valid(result.bytes))throw Error('provider mismatch')
   progress('private_metadata')
   if(!await deps.privateBucket())throw Error('private bucket required')
   progress('private_read')
   const stored=await deps.read(`${originalCheck.digest}/${originalCheck.sha}.mp4`,originalCheck.bytes)
   progress('compare')
   if(c.signal.aborted||!valid(stored)||now()>=originalCheck.expiresAt)throw Error('storage mismatch')
   return reply(200,{status:'verified',taskId:originalCheck.task,sha256:originalCheck.sha,bytes:originalCheck.bytes,providerRead:true,privateRead:true,generated:false,writes:0,automaticIngestionVerified:false})
  })()
  void task.finally(async()=>{try{await deps?.whenSettled()}finally{busy=false}}).catch(()=>{})
  let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([task,new Promise<Response>(resolve=>{timer=setTimeout(()=>{c.abort();resolve(held(Error('diagnostic_deadline')))},45000)})])}catch(error){return held(error)}
  finally{clearTimeout(timer);c.abort();req.signal.removeEventListener('abort',abort)}
 }
}
