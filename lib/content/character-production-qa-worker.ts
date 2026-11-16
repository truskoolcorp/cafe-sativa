import {createRecurringPrivateQa} from './character-production-recurring-qa.ts'
/** Separate post-collection tick: cannot compete for paid receipt persistence.
 * Original work retains process admission after timeout until transports settle. */
export function createPrivateQaWorker(d:{enabled():boolean;authorize(header:string|null):boolean;
 open:Parameters<typeof createRecurringPrivateQa>[0]['open'];timeoutMs?:number}){
 const timeout=d.timeoutMs??45000
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>45000)throw Error('Invalid QA tick deadline')
 const runner=createRecurringPrivateQa({enabled:d.enabled,open:d.open,limit:1})
 let busy=false
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
 return async(req:Request)=>{
  if(req.method!=='GET'||new URL(req.url).search)return reply(405,{status:'unsupported'})
  if(!d.authorize(req.headers.get('authorization')))return reply(401,{status:'unauthorized'})
  if(!d.enabled())return reply(503,{status:'disabled'})
  if(busy)return reply(429,{status:'busy'})
  busy=true
  const controller=new AbortController(),abort=()=>controller.abort()
  req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  let timer:ReturnType<typeof setTimeout>|undefined
  const work=Promise.resolve().then(()=>runner.run(controller.signal))
  void work.finally(()=>{busy=false}).catch(()=>{})
  try{
   const result=await Promise.race([work,new Promise<null>(resolve=>{
    const held=()=>resolve(null);controller.signal.addEventListener('abort',held,{once:true})
    if(controller.signal.aborted)held();timer=setTimeout(abort,timeout)
   })])
   if(!result||controller.signal.aborted)return reply(503,{status:'held'})
   return reply(result.held?503:200,{...result,generated:false,qaApproved:false,publicationApproved:false})
  }catch{return reply(503,{status:'held'})}
  finally{clearTimeout(timer);controller.abort();req.signal.removeEventListener('abort',abort)}
 }
}
