import {createHash} from 'node:crypto'
import type {Pending} from './character-production-engine'
import type {PrivateOutputBackend} from './character-production-scoped'
export const originalRecovery=Object.freeze({key:'zaria-gallery-image-canary-20261114',digest:'01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3',taskId:'c8246007ce21cee14e38f409b4492967',sha:'018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658',bytes:4023955,start:Date.parse('2026-11-14T18:30:00Z'),end:Date.parse('2026-11-14T20:30:00Z')})
type Row={job:Pending;state:'submitted'|'pending_qa'}
export interface RecoveryAccess {read():Promise<unknown>;commit(job:Pending):Promise<boolean>;storage:PrivateOutputBackend;whenSettled():Promise<void>}
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
function valid(r:any):r is Row {const j=r?.job;return !!j&&['submitted','pending_qa'].includes(r.state)&&j.key===originalRecovery.key&&j.digest===originalRecovery.digest&&j.taskId===originalRecovery.taskId&&j.provider==='heygen'&&j.model==='avatar_iv'&&j.providerBindingRevision==='a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0'&&typeof j.token==='string'&&/^[A-Za-z0-9_.:-]{1,240}$/.test(j.token)}
export function createOriginalRecoveryHandler(d:{authorize():Promise<boolean>;open(signal:AbortSignal):RecoveryAccess;now?:()=>number}){
 const now=d.now??Date.now;let busy=false
 const reply=(status:number,body:object)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 return async(req:Request)=>{
  if(req.method!=='POST'||new URL(req.url).search)return reply(405,{error:'Exact recovery POST required'})
  if(req.headers.get('origin')!==new URL(req.url).origin)return reply(403,{error:'Same-origin request required'})
  let admin=false;try{admin=await d.authorize()}catch{return reply(503,{error:'Authentication unavailable'})}
  if(!admin)return reply(401,{error:'Unauthorized'})
  if(now()<originalRecovery.start||now()>=originalRecovery.end)return reply(409,{error:'Recovery window closed'})
  if(busy)return reply(409,{error:'Recovery busy'})
  if(req.headers.get('content-type')!=='video/mp4'||req.headers.get('content-length')!==String(originalRecovery.bytes)||!req.body)return reply(400,{error:'Exact completed output required'})
  busy=true
  const c=new AbortController(),abort=()=>c.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)c.abort()
  let access:RecoveryAccess|undefined,timer:ReturnType<typeof setTimeout>|undefined
  const task=(async()=>{
   const reader=req.body!.getReader(),chunks:Uint8Array[]=[];let size=0
   const cancel=()=>{void reader.cancel().catch(()=>{})};c.signal.addEventListener('abort',cancel,{once:true})
   try{for(;;){const p=await reader.read();if(c.signal.aborted)throw Error('Cancelled');if(p.done)break;size+=p.value.length;if(size>originalRecovery.bytes||chunks.length>=4096)throw Error('Invalid body');chunks.push(Uint8Array.from(p.value))}}finally{c.signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{})}
   const bytes=Buffer.concat(chunks)
   if(size!==originalRecovery.bytes||hash(bytes)!==originalRecovery.sha||bytes.toString('ascii',4,8)!=='ftyp')return reply(400,{error:'Exact completed output required'})
   const authorized=async()=>{if(!await d.authorize()||c.signal.aborted||now()<originalRecovery.start||now()>=originalRecovery.end)throw Error('Recovery authority unavailable')}
   await authorized();access=d.open(c.signal)
   const row=await access.read();if(!valid(row))throw Error('Original reservation unavailable')
   const job=Object.freeze({...row.job}),path=job.digest+'/'+originalRecovery.sha+'.mp4'
   if(!await access.storage.privateBucket())throw Error('Private bucket unavailable')
   await authorized()
   if(row.state==='submitted'){try{await access.storage.insert(path,bytes)}catch{/* immutable readback only; no retry */}}
   const actual=await access.storage.read(path,originalRecovery.bytes)
   if(actual.length!==originalRecovery.bytes||hash(actual)!==originalRecovery.sha)throw Error('Private readback mismatch')
   await authorized()
   const fresh=await access.read();if(!valid(fresh)||Object.keys(job).some(k=>(fresh.job as any)[k]!== (job as any)[k]))throw Error('Original reservation changed')
   if(!await access.commit(job))throw Error('Private attestation held')
   return reply(200,{recovered:true,manualRecovery:true,sha256:originalRecovery.sha,bytes:originalRecovery.bytes,state:'pending_qa',qaApproved:false,publicationApproved:false,newRender:false})
  })()
  void task.catch(()=>{}).then(()=>access?.whenSettled()).catch(()=>{}).finally(()=>{busy=false})
  try{return await Promise.race([task.catch(()=>reply(409,{error:'Recovery held; inspect original output, do not render again'})),new Promise<Response>(resolve=>{timer=setTimeout(()=>{c.abort();resolve(reply(503,{error:'Recovery unconfirmed; inspect private readback'}))},45000)})])}
  finally{clearTimeout(timer);c.abort();req.signal.removeEventListener('abort',abort)}
 }
}
