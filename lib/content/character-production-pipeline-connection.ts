import 'server-only'
import {createHash} from 'node:crypto'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import type {CafePipelineConnection} from './character-production-pipeline-entry'
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===keys.sort().join(',')
/** Concrete dormant scoped opener. No grants or credentials created. The route
 * remains null; installing its runtime RPC privileges is a separate review.
 * whenSettled drains without closing: selected finish must follow prior drain. */
export function openCafePipelineConnection(signal:AbortSignal,enabled:()=>boolean):CafePipelineConnection{
 const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Pipeline capability disabled')}
 check()
 const network=createProductionFetch(signal,(input,init)=>{check();init?.signal?.throwIfAborted();return fetch(input,init)})
 const db=createAdminClient(network.fetch)
 let enrollment:string|undefined,manifest:string|undefined,selection:string|undefined,nextUsed=false,finished=false
 let speechRoot:string|undefined,audioSha:string|undefined
 return {db:{rpc(name,input){
  check();const args=structuredClone(input)
  const context=name==='character_production_pipeline_context'
  if(context){if(!exact(args,[]))throw Error('No caller context allowed')}
  else{
   if(!enrollment||args.p_enrollment!==enrollment)throw Error('Original enrollment required')
   if(name==='character_production_recurring_next'){
    if(!exact(args,['p_enrollment'])||nextUsed)throw Error('Selection already requested')
    nextUsed=true
   }else if(['character_production_recurring_selected','character_production_selected_binding','character_production_recurring_finish'].includes(name)){
    if(!selection||args.p_token!==selection||finished)throw Error('Original selection required')
    if(name==='character_production_recurring_finish'){
     if(!exact(args,['p_enrollment','p_token','p_outcome'])||!['settled','held'].includes(String(args.p_outcome)))throw Error('Invalid finish')
     finished=true
    }else if(!exact(args,['p_enrollment','p_token']))throw Error('Unexpected selection fields')
   }else throw Error('RPC outside pipeline capability')
  }
  let used=false
  return {abortSignal(requestSignal){return {async retry(retry){
   check();requestSignal.throwIfAborted();if(retry!==false||used)throw Error('No retry permitted');used=true
   const result=await db.rpc(name,args).abortSignal(AbortSignal.any([signal,requestSignal])).retry(false);check();requestSignal.throwIfAborted()
   if(!result.error&&result.data&&typeof result.data==='object'){
    const row=result.data as Record<string,unknown>
    if(context&&row.phase==='admit'){
     const identity=row.identity as Record<string,unknown>
     if(!identity||!exact(identity,['textAttemptKey','textAttemptToken','textSourceDigest','scriptSha256'])||typeof identity.textAttemptKey!=='string'||!/^daily:\d{4}-\d{2}-\d{2}:zaria-solenne$/.test(identity.textAttemptKey)||!uuid(identity.textAttemptToken)||![identity.textSourceDigest,identity.scriptSha256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw Error('Original speech identity required')
     const root='production-speech-operations/fresh-zaria-'+createHash('sha256').update(JSON.stringify([identity.textAttemptKey,identity.textAttemptToken,identity.scriptSha256])).digest('hex')
     if(speechRoot&&speechRoot!==root)throw Error('Original speech changed');speechRoot=root
    }
    if(context&&row.phase==='work'){
     if(!uuid(row.enrollmentId)||typeof row.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.manifestSha256))throw Error('Unverified work context')
     if(enrollment&&(row.enrollmentId!==enrollment||row.manifestSha256!==manifest))throw Error('Current enrollment changed')
     enrollment=row.enrollmentId;manifest=row.manifestSha256
    }else if(context&&enrollment)throw Error('Original work context revoked')
    if(name==='character_production_recurring_next'){
     if(row.enrollmentId!==enrollment||row.manifestSha256!==manifest||!uuid(row.selectionToken))throw Error('Original selection mismatch')
     selection=row.selectionToken
    }
   }else if(context&&enrollment)throw Error('Original work context unavailable')
   return result
  }}}}
 }},storage:{
  getBucket(id){check();if(!['cafe-sativa-characters','character-production-audio'].includes(id))throw Error('Unapproved private bucket');return db.storage.getBucket(id)},
  from(id){
   if(!['cafe-sativa-characters','character-production-audio'].includes(id))throw Error('Unapproved private bucket')
   return {download(path,options,params){
    check()
    const valid=id==='cafe-sativa-characters'?!!speechRoot&&['claim.json','receipt.json','provider-receipt.json'].some(name=>path===speechRoot+'/'+name):!!audioSha&&path==='audio/'+audioSha+'.mp3'
    if(!valid||Object.keys(options).length||params.cache!=='no-store'||params.redirect!=='error')throw Error('Exact immutable speech object required')
    const original=db.storage.from(id).download(path,{}, {...params,signal:AbortSignal.any([signal,params.signal])})
    return {async asStream(){
     const result=await original.asStream();try{check();params.signal.throwIfAborted()}catch(error){await result.data?.cancel().catch(()=>{});throw error}
     if(path!==speechRoot+'/provider-receipt.json'||result.error||!result.data)return result
     let length=0;const chunks:Uint8Array[]=[]
     const stream=result.data.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){check();length+=chunk.byteLength;if(length>16384)throw Error('Receipt exceeds bound');chunks.push(Uint8Array.from(chunk));controller.enqueue(chunk)},flush(){
      check();const receipt=JSON.parse(Buffer.concat(chunks,length).toString('utf8'))
      if(receipt.key!==speechRoot!.split('/')[1]||typeof receipt.audioSha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.audioSha256))throw Error('Original audio reference required')
      if(audioSha&&audioSha!==receipt.audioSha256)throw Error('Original audio changed');audioSha=receipt.audioSha256
     }}))
     return {...result,data:stream}
    }}
   }}
  },
 },whenSettled:network.whenSettled}
}
