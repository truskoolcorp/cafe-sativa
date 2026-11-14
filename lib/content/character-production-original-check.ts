import {createHash} from 'node:crypto'
import type {Collection} from './character-production-engine.ts'
export const originalCheck={task:'c8246007ce21cee14e38f409b4492967',binding:'a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0',digest:'01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3',sha:'018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658',bytes:4023955,expiresAt:Date.parse('2026-11-14T22:00:00Z')} as const
interface ReadDependencies{collect(task:string,binding:string):Promise<Collection>;privateBucket():Promise<boolean>;read(path:string,max:number):Promise<Uint8Array>;whenSettled():Promise<void>}
/** No production engine, claim, insert, RPC write or provider creation dependency. */
export function createOriginalCollectionCheck(d:{authorize():Promise<boolean>;open(signal:AbortSignal):ReadDependencies;now?:()=>number}){
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
  let deps:ReadDependencies|undefined
  const task=(async()=>{
   if(c.signal.aborted)throw Error('cancelled')
   deps=d.open(c.signal)
   const result=await deps.collect(originalCheck.task,originalCheck.binding)
   const valid=(b:Uint8Array)=>b instanceof Uint8Array&&b.length===originalCheck.bytes&&createHash('sha256').update(b).digest('hex')===originalCheck.sha
   if(c.signal.aborted||result.state!=='completed'||result.mime!=='video/mp4'||!valid(result.bytes))throw Error('provider mismatch')
   if(!await deps.privateBucket())throw Error('private bucket required')
   const stored=await deps.read(`${originalCheck.digest}/${originalCheck.sha}.mp4`,originalCheck.bytes)
   if(c.signal.aborted||!valid(stored)||now()>=originalCheck.expiresAt)throw Error('storage mismatch')
   return reply(200,{status:'verified',taskId:originalCheck.task,sha256:originalCheck.sha,bytes:originalCheck.bytes,providerRead:true,privateRead:true,generated:false,writes:0,automaticIngestionVerified:false})
  })()
  void task.finally(async()=>{try{await deps?.whenSettled()}finally{busy=false}}).catch(()=>{})
  let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([task,new Promise<Response>(resolve=>{timer=setTimeout(()=>{c.abort();resolve(reply(503,{status:'held'}))},45000)})])}catch{return reply(503,{status:'held'})}
  finally{clearTimeout(timer);c.abort();req.signal.removeEventListener('abort',abort)}
 }
}
