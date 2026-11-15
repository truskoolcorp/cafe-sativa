type Opened={run():Promise<unknown>;whenSettled():Promise<void>;reconciliation?():{bucket:string;path?:string}}
export function createSpeechProbeHandler(d:{authorize():Promise<boolean>;enabled():boolean;open(mode:'probe'|'canon',signal:AbortSignal):Opened;authMs?:number;totalMs?:number}){
 let busy=false
 return async(req:Request)=>{
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}})
  const mode=req.method==='POST'?'probe':req.method==='GET'?'canon':null
  if(!mode||new URL(req.url).search||req.body!==null||mode==='probe'&&req.headers.get('origin')!=='https://www.cafe-sativa.com')return json({status:'unsupported'},400)
  if(mode==='probe'&&!d.enabled())return json({status:'disabled'},503)
  if(busy)return json({status:'busy'},429)
  busy=true
  const life=new AbortController(),abort=()=>life.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  let opened:Opened|undefined,a:ReturnType<typeof setTimeout>|undefined,t:ReturnType<typeof setTimeout>|undefined
  const auth=Promise.resolve().then(()=>d.authorize())
  const task=(async()=>{if(await auth!==true||life.signal.aborted)return json({status:'unauthorized'},401);opened=d.open(mode,life.signal);const result=await opened.run();if(life.signal.aborted)return json({status:'unconfirmed',reconciliation:opened?.reconciliation?.()},503);return json(result)})()
  void task.finally(async()=>{try{await opened?.whenSettled()}finally{busy=false}}).catch(()=>{})
  try{return await Promise.race([task,new Promise<Response>(resolve=>{a=setTimeout(()=>{life.abort();resolve(json({status:'unauthorized'},401))},d.authMs??5000);void auth.finally(()=>clearTimeout(a)).catch(()=>{});t=setTimeout(()=>{life.abort();resolve(json({status:'unconfirmed',reconciliation:opened?.reconciliation?.()},503))},d.totalMs??20000)})])}catch{return json({status:'unconfirmed',reconciliation:opened?.reconciliation?.()},503)}finally{clearTimeout(a);clearTimeout(t);life.abort();req.signal.removeEventListener('abort',abort)}
 }
}
