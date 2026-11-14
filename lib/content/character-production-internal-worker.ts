import {createBrokeredCharacterProductionRuntime} from './character-production-runtime.ts'
import type {CharacterProductionRuntimeConfig,CharacterProductionRuntimeDependencies} from './character-production-runtime.ts'
import {createPrivateOutputBroker} from './character-production-scoped.ts'
import {createPrivateOutputStorage} from './character-production-broker-boundary.ts'
import type {StreamingPrivateStorage} from './character-production-qa-storage.ts'
import {createCharacterProductionCoordinator,createProductionQueue} from './character-production-coordinator.ts'

/** Same-server composition, not a restricted database identity. Existing backend
 * credentials never cross a worker HTTP boundary. Exact provider/canon bindings
 * must be supplied; an environment enable flag cannot fabricate them. */
export type InternalProductionDependencies=Omit<CharacterProductionRuntimeDependencies,'storage'>&{storage:StreamingPrivateStorage}
export function createInternalCharacterWorker(d:{
 enabled():boolean;authorize(header:string|null):boolean;
 configuration:CharacterProductionRuntimeConfig|null;
 open(signal:AbortSignal):InternalProductionDependencies & {whenSettled?():Promise<void>};
 timeoutMs?:number;
}){
 const timeoutMs=d.timeoutMs??45000
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)throw Error('Invalid tick deadline')
 let running=false
 const response=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
 return async(request:Request)=>{
  if(!d.authorize(request.headers.get('authorization')))return response(401,{status:'unauthorized'})
  if(request.method!=='GET')return response(405,{status:'method_not_allowed'})
  if(!d.enabled())return response(503,{status:'disabled'})
  const configuration=d.configuration
  if(!configuration||configuration.engine.enabled!==true||configuration.heygen.enabled!==true)return response(503,{status:'unconfigured',submitted:0})
  if(running)return response(429,{status:'busy'})
  running=true
  const controller=new AbortController(),abort=()=>controller.abort()
  request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort()
  let timer:ReturnType<typeof setTimeout>|undefined
  let settle:(()=>Promise<void>)|undefined
  const task=(async()=>{
   if(controller.signal.aborted)throw Error('Cancelled tick')
   const dependencies=d.open(controller.signal),{rpc,storage}=dependencies
   settle=dependencies.whenSettled
   const broker=createPrivateOutputBroker({rpc,storage:createPrivateOutputStorage(storage,8000),authorize:async job=>{
    try{const result=await rpc.rpc('character_production_broker_authorized',{p_job:job});return !result.error&&result.data===true}catch{return false}
   }},{provider:configuration.engine.provider,model:configuration.engine.model,maxBytes:configuration.engine.maxVideoBytes})
   const engine=createBrokeredCharacterProductionRuntime(configuration,()=>({...dependencies,outputBroker:broker}))
   const coordinator=createCharacterProductionCoordinator({enabled:true,provider:configuration.engine.provider,model:configuration.engine.model,
    collectLimit:1,scanLimit:1,maxSubmissions:1,maxTickMs:45000,now:configuration.engine.now},()=>({engine,queue:createProductionQueue(rpc,configuration.engine.now)}))
   // Collect original task first. Durable SQL nonreclaimable key+budget claim is
   // the cross-instance paid-write fence; this process guard is only admission.
   const result=await coordinator.tick()
   return response(result.status==='held'?503:200,result)
  })()
  // A timed-out response does not release admission while underlying operations
  // remain uncertain. Durable SQL claims also prevent duplicate cross-instance spend.
  const release=async()=>{try{await settle?.()}finally{running=false}}
  void task.then(release,release).catch(()=>{})
  try{return await Promise.race([task,new Promise<Response>(resolve=>{
   const hold=()=>resolve(response(503,{status:'held',submitted:0}))
   controller.signal.addEventListener('abort',hold,{once:true})
   if(controller.signal.aborted)hold()
   timer=setTimeout(()=>controller.abort(),timeoutMs)
  })])}catch{return response(503,{status:'held',submitted:0})}
  finally{clearTimeout(timer);controller.abort();request.signal.removeEventListener('abort',abort)}
 }
}
