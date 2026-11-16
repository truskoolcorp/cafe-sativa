import {hasEmptyRequestBody} from './character-production-empty-request-body.ts'
export type SpeechProbeAttempt={id:string;expiresAt:string}
const validAttempt=(a:SpeechProbeAttempt|undefined)=>!!a&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.id)&&Number.isFinite(Date.parse(a.expiresAt))&&Date.parse(a.expiresAt)>Date.now()
type Opened={run():Promise<unknown>;whenSettled():Promise<void>;reconciliation?():{bucket:string;path?:string}}
export function createSpeechProbeHandler(d:{authorize():Promise<boolean>;enabled():boolean;attempt():SpeechProbeAttempt|undefined;open(mode:'probe'|'canon',signal:AbortSignal,attempt?:SpeechProbeAttempt):Opened;authMs?:number;totalMs?:number}){
 let busy=false
 return async(req:Request)=>{
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}})
  const mode=req.method==='POST'?'probe':req.method==='GET'?'canon':null
  if(!mode||new URL(req.url).search||mode==='probe'&&req.headers.get('origin')!=='https://www.cafe-sativa.com')return json({status:'unsupported'},400)
  if(!await hasEmptyRequestBody(req))return json({status:'unsupported',reason:'nonempty_or_unreadable_body'},400)
  const configured=mode==='probe'?d.attempt():undefined,attempt=configured?Object.freeze({...configured}):undefined
  if(mode==='probe'&&(!d.enabled()||!validAttempt(attempt)))return json({status:'disabled'},503)
  if(busy)return json({status:'busy'},429)
  busy=true
  const life=new AbortController(),abort=()=>life.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  let opened:Opened|undefined,a:ReturnType<typeof setTimeout>|undefined,t:ReturnType<typeof setTimeout>|undefined
  const auth=Promise.resolve().then(()=>d.authorize())
  const task=(async()=>{if(await auth!==true||life.signal.aborted)return json({status:'unauthorized'},401);if(mode==='probe'&&!validAttempt(attempt))return json({status:'expired'},503);opened=d.open(mode,life.signal,attempt);const result=await opened.run();if(life.signal.aborted)return json({status:'unconfirmed',reconciliation:opened?.reconciliation?.()},503);return json(result)})()
  void task.finally(async()=>{try{await opened?.whenSettled()}finally{busy=false}}).catch(()=>{})
  try{return await Promise.race([task,new Promise<Response>(resolve=>{a=setTimeout(()=>{life.abort();resolve(json({status:'unauthorized'},401))},d.authMs??5000);void auth.finally(()=>clearTimeout(a)).catch(()=>{});t=setTimeout(()=>{life.abort();resolve(json({status:'unconfirmed',reconciliation:opened?.reconciliation?.()},503))},Math.max(1,Math.min(d.totalMs??20000,mode==='probe'?Date.parse(attempt!.expiresAt)-Date.now():Infinity)))})])}catch{return json({status:'unconfirmed',reconciliation:opened?.reconciliation?.()},503)}finally{clearTimeout(a);clearTimeout(t);life.abort();req.signal.removeEventListener('abort',abort)}
 }
}
