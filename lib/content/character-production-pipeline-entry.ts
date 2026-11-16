import 'server-only'
import {createHash} from 'node:crypto'
import {createCafePreparationOperation} from './character-production-preparation-server'
import {createCafeFirstAdmissionOperation} from './character-production-first-admission-server'
import {createFreshSpeechReceiptReader,type PersistedFreshTextIdentity,type FreshReceiptStorage} from './character-production-fresh-speech-receipt-store'
import {createSelectedRecurringSession} from './character-production-selected-server'
import {createProductionTimeBudget} from './character-production-time-budget'
import {snapshotProductionManifest} from './character-production-manifest-snapshot'
import type {InternalProductionManifest} from './character-production-server-composition'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
type Context={phase:'prepare';occurrenceId:string}|{phase:'admit';occurrenceId:string;identity:PersistedFreshTextIdentity}|{phase:'work';occurrenceId:string;enrollmentId:string;manifestSha256:string;manifest:string}
export type CafePipelineConnection={db:ProductionServerRpcClient;storage:FreshReceiptStorage;whenSettled():Promise<void>}
export type CafePipelineConfig={
 authorize(header:string|null):boolean;
 /** Hosting lifecycle must retain the original task and all transport drainage. */
 retain(work:Promise<void>):void;
 /** Code-reviewed account/model/limits, empty images and avatar bindings. */
 manifest:InternalProductionManifest;
 /** Separately approved narrow capability, native abort/flag guard and drain.
  * No request identity, implicit service-role RPC or credential fallback. */
 open(signal:AbortSignal,enabled:()=>boolean):CafePipelineConnection;
}
/** One finite operation per request. Original receipts are read-only admission
 * proof, never a new speech request. Work uses the existing selected engine.
 * The route remains unconfigured until a reviewed code-owned opener is supplied. */
export function createCafePipelineEntry(input:CafePipelineConfig){
 const base=snapshotProductionManifest(input.manifest),authorize=input.authorize,open=input.open,retain=input.retain
 if(base.images.length||base.configuration.heygen.bindings.length||base.exactScope)throw Error('No static occurrence binding allowed')
 const enabled=()=>process.env.CS_CHARACTER_PIPELINE_ENTRY_ENABLED==='true'
 let busy=false
 const reply=(status:string,code=200,phase?:string)=>Response.json({status,...(phase?{phase}:{}),publicationVerified:false},{status:code,headers:{'Cache-Control':'private, no-store'}})
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='GET'||request.body!==null||new URL(request.url).search)return reply('unsupported',405)
  if(!authorize(request.headers.get('authorization')))return reply('unauthorized',401)
  if(!enabled())return reply('disabled',503)
  if(request.signal.aborted)return reply('held',503)
  if(busy)return reply('busy',429)
  busy=true
  const life=new AbortController(),onAbort=()=>life.abort(),timer=setTimeout(onAbort,85000)
  request.signal.addEventListener('abort',onAbort,{once:true})
  if(request.signal.aborted)onAbort()
  const signal=life.signal
  let connection:CafePipelineConnection|undefined,child:{whenSettled():Promise<void>}|undefined,receipt:ReturnType<typeof createFreshSpeechReceiptReader>|undefined
  const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Pipeline admission disabled')}
  const task=Promise.resolve().then(async()=>{
   try{
    check();connection=open(signal,enabled)
    const read=async()=>{
     check();const r=await connection!.db.rpc('character_production_pipeline_context',{}).abortSignal(signal).retry(false);check()
     if(r.error)throw Error('Current occurrence unavailable')
     if(r.data===null)return null
     const c=r.data as Record<string,unknown>
     if(c.phase==='held')throw Error('Original occurrence held')
     const keys=c.phase==='prepare'?['occurrenceId','phase']:c.phase==='admit'?['identity','occurrenceId','phase']:['enrollmentId','manifest','manifestSha256','occurrenceId','phase']
     const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
     if(!['prepare','admit','work'].includes(String(c.phase))||Object.keys(c).sort().join(',')!==keys.sort().join(',')||!uuid(c.occurrenceId))throw Error('Invalid current occurrence')
     if(c.phase==='work'&&(!uuid(c.enrollmentId)||typeof c.manifest!=='string'||Buffer.byteLength(c.manifest)>65536||typeof c.manifestSha256!=='string'||createHash('sha256').update(c.manifest).digest('hex')!==c.manifestSha256))throw Error('Invalid admitted manifest')
     return structuredClone(c) as unknown as Context
    }
    const original=await read();if(!original)return reply('unconfigured',503)
    const current=async()=>{const now=await read();if(JSON.stringify(now)!==JSON.stringify(original))throw Error('Original occurrence changed')}
    if(original.phase==='prepare'){
     await current();const op=createCafePreparationOperation();child=op
     const result=await op.run(signal);check()
     return reply(result.status,200,'prepare')
    }
    if(original.phase==='admit'){
     receipt=createFreshSpeechReceiptReader(original.identity,{storage:connection.storage,signal,enabled,timeoutMs:30000})
     const recovered=await receipt.recover();await receipt.whenSettled();check()
     if(recovered.status!=='private_audio_receipt_verified')return reply('held_original_speech',503,'admit')
     await current()
     const op=createCafeFirstAdmissionOperation();child=op
     const result=await op.run(signal);check()
     return reply(result.status,200,'admit')
    }
    const admitted=JSON.parse(original.manifest)
    if(admitted.candidates?.length!==1||admitted.images?.length!==1||admitted.candidates[0].slot?.key!=='first:'+original.occurrenceId)throw Error('Exact first occurrence required')
    const slot=admitted.candidates[0].slot,account=admitted.heygen
    if(admitted.expectedUsername!==base.expectedHeyGenUsername||account?.linkId!==base.configuration.heygen.linkId||account?.model!==base.configuration.heygen.model||account?.aspectRatio!==base.configuration.heygen.aspectRatio||!base.configuration.engine.characters.includes(slot.characterId))throw Error('Admitted occurrence outside reviewed configuration')
    await current()
    const session=createSelectedRecurringSession({signal,budget:createProductionTimeBudget(signal,45000),manifest:base,
     selectorRpc:{async rpc(name,args){await current();const r=await connection!.db.rpc(name,args).abortSignal(signal).retry(false);check();return r}},
     enrollmentId:original.enrollmentId,manifestSha256:original.manifestSha256,now:Date.now,enabled,
     whenSelectorSettled:()=>connection!.whenSettled()})
    child=session
    const phase=await session.next(signal);check()
    if(phase===null)return reply('waiting',200,'work')
    const stage=session.stages[phase];if(!stage)throw Error('Missing selected phase')
    await stage(signal);check()
    return reply('phase_settled',200,phase)
   }catch{return reply('held',503)}
  })
  const drained=task.then(async()=>{
   life.abort()
   const results=await Promise.allSettled([...(receipt?[receipt.whenSettled()]:[]),...(child?[child.whenSettled()]:[]),...(connection?[connection.whenSettled()]:[])])
   if(results.every(r=>r.status==='fulfilled'))busy=false
  })
  // Register before the first task microtask or any early timeout response.
  try{retain(drained)}catch{life.abort();await drained;clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);return reply('held',503)}
  let cancel:()=>void=()=>{}
  const aborted=new Promise<Response>(resolve=>{cancel=()=>resolve(reply('held',503));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()})
  try{return await Promise.race([task,aborted])}
  finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);request.signal.removeEventListener('abort',onAbort);life.abort()}
 }
}
