import { createHash } from 'node:crypto'
import { productionSlotDigest } from './character-production-engine.ts'
import type { ProductionStore, ProductionSlot, Pending, Collected } from './character-production-engine.ts'

/** Inject a server-only client. No credentials, grants, ACL changes or URLs. */
export interface ProductionRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}
export interface PrivateObjects {
  getBucket(id: string): PromiseLike<{ data: { id: string; public: boolean } | null; error: unknown }>
  from(id: string): { upload(path: string, body: Uint8Array, options: { contentType: string; upsert: false }): PromiseLike<{ error: unknown }> }
}
const hash = /^[a-f0-9]{64}$/
const id = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const isId = (v:unknown): v is string => typeof v==='string' && id.test(v)
const isHash = (v:unknown): v is string => typeof v==='string' && hash.test(v)
const record = (v:unknown): v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v)
function validJob(v:unknown): v is Pending {
  return record(v) && [v.key,v.token,v.taskId,v.provider,v.model].every(isId) && isHash(v.digest) && isHash(v.providerBindingRevision)
}
/** Fail closed on uncertain RPC/upload receipts. Never retry paid work, reclaim
 * slots, release reservations or interpret object conflicts as checksum proof. */
export function createPostgresProductionStore(rpc: ProductionRpc, storage: PrivateObjects,
 config: {bucket:string;maxVideoBytes:number}): ProductionStore {
 const bucket=config.bucket,max=config.maxVideoBytes
 if(bucket!=='character-production-private'||!Number.isSafeInteger(max)||max<12||max>50_000_000)throw Error('Invalid private store configuration')
 async function call(name:string,args:Record<string,unknown>){
  const result=await rpc.rpc('character_production_'+name,args)
  if(result.error)throw Error('Production persistence failed')
  return result.data
 }
 const jobArgs=(j:Pending)=>{if(!validJob(j))throw Error('Invalid job identity');return {p_job:j}}
 return {
  async claim(slot:ProductionSlot,digest:string){
   if(!isHash(slot.providerBindingRevision)||!isHash(digest)||productionSlotDigest(slot)!==digest)throw Error('Invalid slot digest')
   const result=await call('claim',{p_slot:slot,p_digest:digest})
   if(result===null)return null
   if(!record(result)||!isId(result.token)||result.digest!==digest)throw Error('Invalid claim receipt')
   return {token:result.token,digest}
  },
  async markSubmitted(key,token,digest,taskId){
   if(![key,token,taskId].every(isId)||!isHash(digest))throw Error('Invalid receipt')
   return await call('submitted',{p_key:key,p_token:token,p_digest:digest,p_task:taskId})===true
  },
  async markUnknown(key,token,digest){
   if(![key,token].every(isId)||!isHash(digest))throw Error('Invalid claim')
   await call('unknown',{p_key:key,p_token:token,p_digest:digest})
  },
  async pending(provider,model,limit){
   if(!isId(provider)||!isId(model)||!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('Invalid pending query')
   const rows=await call('pending',{p_provider:provider,p_model:model,p_limit:limit})
   if(!Array.isArray(rows)||rows.length>limit||rows.some(j=>!validJob(j)||j.provider!==provider||j.model!==model))throw Error('Invalid pending response')
   return rows as Pending[]
  },
  async markFailed(job){await call('failed',jobArgs(job))},
  async savePrivate(job,media:Collected & {sha256:string}){
   const args=jobArgs(job)
   if(media.mime!=='video/mp4'||!(media.bytes instanceof Uint8Array)||media.bytes.byteLength<12||media.bytes.byteLength>max)throw Error('Invalid video bytes')
   const bytes=Uint8Array.from(media.bytes),sha=createHash('sha256').update(bytes).digest('hex')
   if(sha!==media.sha256||Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw Error('Invalid video hash or signature')
   const path=`${job.digest}/${sha}.mp4`
   const prepared=await call('output_status',{...args,p_sha:sha,p_bytes:bytes.length})
   if(prepared==='committed')return true
   if(prepared!=='upload')return false
   const meta=await storage.getBucket(bucket)
   if(meta.error||!meta.data||meta.data.id!==bucket||meta.data.public!==false)throw Error('Private bucket required')
   const uploaded=await storage.from(bucket).upload(path,bytes,{contentType:'video/mp4',upsert:false})
   if(uploaded.error)throw Error('Private upload unconfirmed')
   return await call('output',{...args,p_sha:sha,p_bytes:bytes.length})===true
  },
 }
}
