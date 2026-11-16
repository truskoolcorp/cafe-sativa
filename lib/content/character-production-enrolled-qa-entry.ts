import {createEnrolledQaRpc} from './character-production-enrolled-qa.ts'
import {createCharacterProductionQaBridge,type QaBridgeObjects} from './character-production-qa-bridge.ts'
import type {ProductionServerRpcClient} from './character-production-server-rpc.ts'
import type {ExactProductionScope} from './character-production-exact-scope.ts'
/** Private ingestion only, not approval/publication. No route, enrollment or client created. */
export function createEnrolledQaEntry(enrollment:string,scopes:readonly ExactProductionScope[],d:{
 enabled():boolean;authorize(header:string|null):boolean;
 open(signal:AbortSignal):{db:ProductionServerRpcClient;storage:QaBridgeObjects;whenSettled():Promise<void>};
 timeoutMs?:number;
}){
 const reviewed=scopes.map(s=>Object.freeze({...s})),ms=d.timeoutMs??45000
 if(!Number.isSafeInteger(ms)||ms<1||ms>45000)throw Error('Invalid QA deadline')
 let running=false
 return async(request:Request)=>{
  const reply=(status:number,value:string)=>Response.json({status:value},{status,headers:{'Cache-Control':'private, no-store'}})
  if(!d.authorize(request.headers.get('authorization')))return reply(401,'unauthorized')
  if(request.method!=='GET')return reply(405,'method_not_allowed')
  if(!d.enabled())return reply(503,'disabled')
  if(request.signal.aborted)return reply(503,'held')
  if(running)return reply(429,'busy')
  running=true
  const life=new AbortController(),abort=()=>life.abort();request.signal.addEventListener('abort',abort,{once:true})
  let settle:(()=>Promise<void>)|undefined,timer:ReturnType<typeof setTimeout>|undefined
  const task=(async()=>{
   if(life.signal.aborted)throw Error('Cancelled')
   const deps=d.open(life.signal);settle=()=>deps.whenSettled()
   const rpc=createEnrolledQaRpc(deps.db,life.signal,enrollment,reviewed)
   const found=await rpc.rpc('character_production_qa_ready_slots',{p_limit:1})
   if(found.error||life.signal.aborted)throw Error('QA discovery unconfirmed')
   const rows=found.data as {key:string;digest:string}[]
   if(!rows.length)return reply(200,'idle')
   const {key,digest}=rows[0]
   const materialized=await rpc.rpc('character_production_qa_materialize',{p_key:key,p_digest:digest})
   if(materialized.error||materialized.data!==true||life.signal.aborted)return reply(503,'held')
   const result=await createCharacterProductionQaBridge(rpc,deps.storage).ingest(key,digest)
   return life.signal.aborted?reply(503,'held'):reply(result.status==='ingested'?200:503,result.status)
  })()
  void task.then(async()=>{await settle?.()},async()=>{await settle?.()}).catch(()=>{}).finally(()=>{running=false})
  try{return await Promise.race([task,new Promise<Response>(resolve=>{
   life.signal.addEventListener('abort',()=>resolve(reply(503,'held')),{once:true})
   timer=setTimeout(abort,ms);if(request.signal.aborted)abort()
  })])}catch{return reply(503,'held')}finally{clearTimeout(timer);life.abort();request.signal.removeEventListener('abort',abort)}
 }
}
