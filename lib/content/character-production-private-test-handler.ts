import {emptyQaBody} from './character-production-empty-body'
export const PRIVATE_TEST_EXPIRES_AT=Date.parse('2026-11-17T06:00:00Z')
type Operation={run(signal:AbortSignal):Promise<unknown>;whenSettled():Promise<void>}
type Dependencies={authorize():Promise<boolean>;enabled():boolean;open():Operation;retain(work:Promise<void>):void;now?:()=>number;deadlineMs?:number;authMs?:number}
/** Finite original text/speech preparation only. No media generation, first
 * admission, recurring worker, publication, caller scope or authority creation. */
export function createPrivateTestHandler(d:Dependencies){
 const now=d.now??Date.now,deadline=d.deadlineMs??85000,authMs=d.authMs??5000
 if(!Number.isSafeInteger(deadline)||deadline<1||deadline>85000||!Number.isSafeInteger(authMs)||authMs<1||authMs>5000)throw Error('Invalid private-test deadline')
 let busy=false
 const reply=(status:string,code=200)=>Response.json({status,qaApproved:false,publicationApproved:false,videoRequested:false,recurringActivationRequested:false},{status:code,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 const statusOf=(v:unknown):string=>{
  if(!v||typeof v!=='object'||!('status' in v)||typeof v.status!=='string')throw Error('Unconfirmed preparation result')
  if(['disabled','unconfigured','held_original_text','held_authority','held_original_speech'].includes(v.status))return v.status
  const nested='result' in v?v.result:null
  if(v.status==='text_phase_finished'&&nested&&typeof nested==='object'&&'status' in nested&&nested.status==='awaiting_audio_binding_and_qa')return 'private_text_saved'
  if(v.status==='speech_phase_finished'&&nested&&typeof nested==='object'&&'status' in nested&&nested.status==='private_pending_qa')return 'private_audio_saved'
  if(v.status==='original_speech_verified'&&'receipt' in v&&v.receipt&&typeof v.receipt==='object'&&'status' in v.receipt&&v.receipt.status==='private_audio_receipt_verified')return 'original_private_audio_verified'
  throw Error('Unconfirmed preparation result')
 }
 return async(req:Request):Promise<Response>=>{
  const url=new URL(req.url)
  if(req.method!=='POST'||url.search||url.origin!=='https://www.cafe-sativa.com'||req.headers.get('origin')!==url.origin)return reply('unsupported',403)
  if(!d.enabled()||now()>=PRIVATE_TEST_EXPIRES_AT)return reply('disabled',503)
  if(req.signal.aborted)return reply('held',503)
  if(busy)return reply('busy',429)
  busy=true
  const life=new AbortController(),abort=()=>life.abort()
  req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  const total=setTimeout(abort,Math.min(deadline,Math.max(1,PRIVATE_TEST_EXPIRES_AT-now())))
  let operation:Operation|undefined,body:ReturnType<typeof emptyQaBody>|undefined,authTimer:ReturnType<typeof setTimeout>|undefined
  const check=()=>{life.signal.throwIfAborted();if(!d.enabled()||now()>=PRIVATE_TEST_EXPIRES_AT)throw Error('Private test disabled')}
  const task=Promise.resolve().then(async()=>{
   try{
    check();authTimer=setTimeout(abort,authMs)
    const authorized=await d.authorize();clearTimeout(authTimer)
    if(!authorized)return reply('unauthorized',401)
    check();body=emptyQaBody(req,life.signal)
    const state=await body.check();check()
    if(state!=='empty')return reply(state==='nonempty'?'unsupported_body':'body_unconfirmed',400)
    operation=d.open();check()
    const result=await operation.run(life.signal);check()
    const status=statusOf(result)
    return reply(status,['private_text_saved','private_audio_saved','original_private_audio_verified'].includes(status)?200:503)
   }catch{return reply('held',503)}
  })
  const drained=task.then(async()=>{
   life.abort()
   const results=await Promise.allSettled([...(body?[body.whenSettled()]:[]),...(operation?[operation.whenSettled()]:[])])
   if(results.every(r=>r.status==='fulfilled'))busy=false
  })
  try{d.retain(drained)}catch{life.abort();await drained;clearTimeout(total);clearTimeout(authTimer);req.signal.removeEventListener('abort',abort);return reply('held',503)}
  let onAbort=()=>{}
  const cancelled=new Promise<Response>(resolve=>{onAbort=()=>resolve(reply('held',503));life.signal.addEventListener('abort',onAbort,{once:true});if(life.signal.aborted)onAbort()})
  try{return await Promise.race([task,cancelled])}
  finally{clearTimeout(total);clearTimeout(authTimer);life.signal.removeEventListener('abort',onAbort);req.signal.removeEventListener('abort',abort);life.abort()}
 }
}
