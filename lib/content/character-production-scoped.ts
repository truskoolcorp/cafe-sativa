import {createHash} from 'node:crypto'
import {createPostgresProductionStore} from './character-production-store.ts'
import type {ProductionRpc} from './character-production-store.ts'
import type {Pending,Collected,ProductionStore} from './character-production-engine.ts'

/** Trusted server-only session already authenticated as the separately provisioned
 * restricted role. This adapter never logs in, SET ROLEs or accepts SQL from callers.
 * Driver must bound connection/query timeouts and disable automatic write retries. */
export interface RestrictedSession {query(sql:string,values:readonly unknown[]):Promise<{rows:ReadonlyArray<{value:unknown}>}>}
const generator={
 authorization:['p_key','p_authorization_id'],claim:['p_slot','p_digest'],
 submitted:['p_key','p_token','p_digest','p_task'],unknown:['p_key','p_token','p_digest'],
 pending:['p_provider','p_model','p_limit'],failed:['p_job'],due:['p_provider','p_model','p_limit'],
} as const
const broker={output_status:['p_job','p_sha','p_bytes'],output:['p_job','p_sha','p_bytes']} as const
/** Allowlisting is defense in depth, NOT a substitute for restricted DB grants.
 * The generator cannot attest private output or access QA/publication RPCs. */
export function createRestrictedProductionRpc(session:RestrictedSession,capability:'generator'|'output-broker'):ProductionRpc {
 const allowed:Record<string,readonly string[]>=capability==='generator'?generator:capability==='output-broker'?broker:{}
 return {async rpc(name,args){
  try {
   if(!Object.hasOwn(args??{},'__proto__')&&name.startsWith('character_production_')){
    const suffix=name.slice('character_production_'.length)
    if(Object.hasOwn(allowed,suffix)){
     const keys=allowed[suffix]
     if(Object.keys(args).length===keys.length&&keys.every(k=>Object.hasOwn(args,k))){
      // Identifier is chosen only from the fixed allowlist; values always bound.
      const values=keys.map(k=>structuredClone(args[k]))
      const result=await session.query(`SELECT public.character_production_${suffix}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,values)
      if(result.rows.length===1&&Object.hasOwn(result.rows[0],'value'))return {data:result.rows[0].value,error:null}
     }
    }
   }
  }catch{/* uncertain writes are never retried or exposed as raw driver errors */}
  return {data:null,error:'Scoped persistence unavailable'}
 }}
}
const bucket='character-production-private'
const isHash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const isId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/.test(v)
export interface PrivateOutputBackend {
 /** Must observe real bucket metadata; cannot return a configured constant. */
 privateBucket():Promise<boolean>
 /** INSERT-only. Transport must not retry, overwrite or follow redirects. */
 insert(path:string,bytes:Uint8Array):Promise<void>
 /** Exact-key bounded private read, no listings, redirects or public URLs. */
 read(path:string,maxBytes:number):Promise<Uint8Array>
}
export interface OutputBroker {save(job:Pending,media:Collected&{sha256:string}):Promise<boolean>}
/** Intended to run behind independently authenticated server-to-server boundary.
 * No signing token or broad storage credential is returned to the generator.
 * authorize must read current trusted exact job/slot authority, not caller claims.
 * This is an internal dependency contract, not an invented provider HTTP API. */
export function createPrivateOutputBroker(d:{rpc:ProductionRpc;storage:PrivateOutputBackend;authorize(job:Readonly<Pending>):Promise<boolean>},scope:{provider:string;model:string;maxBytes:number}):OutputBroker {
 const {provider,model,maxBytes}=scope
 if(!isId(provider)||!isId(model)||!Number.isSafeInteger(maxBytes)||maxBytes<16||maxBytes>35*1024*1024)throw Error('Invalid broker scope')
 return {async save(input,media){
  try {
   const job=Object.freeze({...input})
   if(![job.key,job.token,job.taskId].every(isId)||!isHash(job.digest)||!isHash(job.providerBindingRevision)||job.provider!==provider||job.model!==model)return false
   if(media.mime!=='video/mp4'||!(media.bytes instanceof Uint8Array)||media.bytes.length<16||media.bytes.length>maxBytes)return false
   const bytes=Uint8Array.from(media.bytes),sha=createHash('sha256').update(bytes).digest('hex')
   if(sha!==media.sha256||Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')return false
   const args={p_job:job,p_sha:sha,p_bytes:bytes.length},path=`${job.digest}/${sha}.mp4`
   if(await d.authorize(job)!==true)return false
   const receipt=await d.rpc.rpc('character_production_output_status',args)
   if(receipt.error||!['upload','committed'].includes(receipt.data as string)||await d.storage.privateBucket()!==true)return false
   // Unknown upload outcome can only be reconciled by exact bounded byte readback.
   if(receipt.data==='upload'){
    if(await d.authorize(job)!==true)return false
    try{await d.storage.insert(path,bytes)}catch{/* no retry */}
   }
   const actual=await d.storage.read(path,maxBytes)
   if(!(actual instanceof Uint8Array)||actual.length!==bytes.length||createHash('sha256').update(actual).digest('hex')!==sha)return false
   if(await d.authorize(job)!==true)return false
   if(receipt.data==='committed')return true
   const committed=await d.rpc.rpc('character_production_output',args)
   return !committed.error&&committed.data===true
  }catch{return false}
 }}
}
/** Compatible engine store: ordinary operations use restricted generator RPC;
 * private upload + output attestation are delegated to the isolated broker. */
export function createBrokeredProductionStore(rpc:ProductionRpc,broker:OutputBroker):ProductionStore {
 const disabledStorage={getBucket:async()=>{throw Error('Direct storage forbidden')},from:()=>({upload:async()=>{throw Error('Direct storage forbidden')}})}
 const base=createPostgresProductionStore(rpc,disabledStorage,{bucket,maxVideoBytes:35*1024*1024})
 return {...base,savePrivate:(job,media)=>broker.save(job,media)}
}
