import {hasEmptyRequestBody} from './character-production-empty-request-body.ts'
import type {IncludedSpeechOperation} from './character-production-included-speech-operation.ts'
import {validateIncludedSpeechOperation} from './character-production-included-speech-operation.ts'
type Opened={run():Promise<unknown>;whenSettled():Promise<void>}
/** No route registered. Auth/body rejection precedes all provider/storage/key opens.
 * Busy remains held until late underlying work settles, not merely until response. */
export function createIncludedSpeechHandler(input:IncludedSpeechOperation,d:{enabled():boolean;authorize():Promise<boolean>;open(s:IncludedSpeechOperation,signal:AbortSignal):Opened;origin:string;now?():number;deadlineMs?:number;authMs?:number}){
 const s=Object.freeze({...input});validateIncludedSpeechOperation(s)
 const deadline=d.deadlineMs??90000,authMs=d.authMs??5000,now=d.now??Date.now
 if(!Number.isInteger(deadline)||deadline<1||deadline>90000||!Number.isInteger(authMs)||authMs<1||authMs>5000)throw Error('deadline_unverified')
 let busy=false
 return async(req:Request):Promise<Response>=>{
  const response=(status:string,code:number)=>Response.json({status,qaApproved:false,publicationApproved:false},{status:code,headers:{'Cache-Control':'private, no-store'}})
  if(!d.enabled()||now()>=s.expiresAt)return response('disabled',503)
  if(req.method!=='POST'||new URL(req.url).search||req.headers.get('origin')!==d.origin)return response('unsupported_request',400)
  if(!await hasEmptyRequestBody(req))return response('nonempty_or_unreadable_body',400)
  if(req.signal.aborted)return response('cancelled',499)
  if(busy)return response('busy',429)
  busy=true
  const life=new AbortController(),abort=()=>life.abort();req.signal.addEventListener('abort',abort,{once:true})
  let opened:Opened|undefined,authTimer:ReturnType<typeof setTimeout>|undefined,totalTimer:ReturnType<typeof setTimeout>|undefined
  const authorization=Promise.resolve().then(()=>d.authorize())
  const task=(async()=>{
   if(await authorization!==true||life.signal.aborted)return response('unauthorized',401)
   if(now()>=s.expiresAt)return response('disabled',503)
   opened=d.open(s,life.signal)
   await opened.run()
   if(life.signal.aborted)return response('held',503)
   return response('private_pending_qa',200)
  })()
  void task.finally(async()=>{try{await opened?.whenSettled()}finally{busy=false}}).catch(()=>{})
  try{return await Promise.race([task,new Promise<Response>(resolve=>{
   authTimer=setTimeout(()=>{life.abort();resolve(response('unauthorized',401))},authMs)
   void authorization.finally(()=>clearTimeout(authTimer)).catch(()=>{})
   totalTimer=setTimeout(()=>{life.abort();resolve(response('held',503))},deadline)
   life.signal.addEventListener('abort',()=>resolve(response('held',503)),{once:true})
  })])}catch{return response('held',503)}finally{clearTimeout(authTimer);clearTimeout(totalTimer);life.abort();req.signal.removeEventListener('abort',abort)}
 }
}
