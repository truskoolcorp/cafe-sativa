import {createHash,timingSafeEqual} from 'node:crypto'
import {createStreamingQaStorage} from './character-production-qa-storage.ts'
import type {StreamingPrivateStorage} from './character-production-qa-storage.ts'
import type {ProductionRpc} from './character-production-store.ts'
import type {Pending} from './character-production-engine.ts'
const bucket='character-production-private',cap=35*1024*1024
export interface SignedOutputStorage extends StreamingPrivateStorage {
 getBucket(id:string):PromiseLike<{data:{id:string;public:boolean;file_size_limit?:number|null;allowed_mime_types?:string[]|null}|null;error:unknown}>
 from(id:string):ReturnType<StreamingPrivateStorage['from']>&{
 createSignedUploadUrl(path:string,options:{upsert:false}):PromiseLike<{data:{path:string;token:string;signedUrl:string}|null;error:unknown}>
 }
}
const hash=(s:string)=>createHash('sha256').update(s).digest()
const same=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(hash(a),hash(b))
const fields=['key','token','digest','taskId','provider','model','providerBindingRevision'] as const
function validJob(j:Pending){return j&&Object.keys(j).length===fields.length&&fields.every(k=>typeof j[k]==='string'&&j[k].length>0&&j[k].length<=240)&&/^[a-f0-9]{64}$/.test(j.digest)&&/^[a-f0-9]{64}$/.test(j.providerBindingRevision)}
/** Internal trusted-backend factory only: no mounted route, no credentials.
 * The injected existing backend Storage client is privileged; this is not DB
 * isolation. Never expose it to worker. All RPC writes disable automatic retry. */
export function createTwoPhaseOutput(d:{rpc:ProductionRpc;storage:SignedOutputStorage;now?:()=>number;timeoutMs?:number}){
 const now=d.now??Date.now,timeout=d.timeoutMs??15000
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000)throw Error('Invalid deadline')
 const reader=createStreamingQaStorage(d.storage,timeout)
 const bounded=async<T>(action:()=>PromiseLike<T>)=>{let t:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve().then(action),new Promise<never>((_,reject)=>{t=setTimeout(()=>reject(Error('Operation unconfirmed')),timeout)})])}finally{clearTimeout(t)}}
 async function privateBucket(){const r=await bounded(()=>d.storage.getBucket(bucket));return !r.error&&r.data?.id===bucket&&r.data.public===false&&Number.isSafeInteger(r.data.file_size_limit)&&r.data.file_size_limit!>=16&&r.data.file_size_limit!<=cap&&r.data.allowed_mime_types?.length===1&&r.data.allowed_mime_types[0]==='video/mp4'?r.data.file_size_limit!:null}
 function intent(data:unknown,job:Pending){const v=data as {job:Pending;sha:string;bytes:number;path:string;expiresAt:number};if(!v||!validJob(v.job)||!fields.every(k=>same(v.job[k],job[k]))||!/^[a-f0-9]{64}$/.test(v.sha)||!Number.isSafeInteger(v.bytes)||v.bytes<16||v.bytes>cap||v.path!==job.digest+'/'+v.sha+'.mp4'||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=now()||v.expiresAt>now()+120000)return null;return v}
 return {
  async reserve(job:Pending,sha:string,bytes:number){try{
   if(!validJob(job)||!/^[a-f0-9]{64}$/.test(sha)||!Number.isSafeInteger(bytes)||bytes<16||bytes>cap)return null
   const actualLimit=await privateBucket();if(actualLimit===null||bytes>actualLimit)return null
   const r=await bounded(()=>d.rpc.rpc('character_production_upload_reserve',{p_job:job,p_sha:sha,p_bytes:bytes}));if(r.error)return null
   const i=intent(r.data,job);if(!i||i.sha!==sha||i.bytes!==bytes)return null
   // Reserve consumed even if signing times out: never mint a second capability.
   const signed=await bounded(()=>d.storage.from(bucket).createSignedUploadUrl(i.path,{upsert:false}))
   if(signed.error||signed.data?.path!==i.path||!signed.data.token||signed.data.token.length>8192||now()>=i.expiresAt)return null
   // Do not return arbitrary provider URL; caller uses fixed project SDK + path/token.
   return {bucket,path:i.path,token:signed.data.token,finalizeBefore:i.expiresAt,providerUploadValiditySeconds:7200}
  }catch{return null}},
  async finalize(job:Pending){try{
   if(!validJob(job)||!await privateBucket())return false
   const r=await bounded(()=>d.rpc.rpc('character_production_upload_inspect',{p_job:job}));if(r.error)return false
   const i=intent(r.data,job);if(!i)return false
   const media=await reader.from(bucket).download(i.path,i.bytes);if(media.error||!media.data)return false
   const bytes=media.data;if(bytes.length!==i.bytes||Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp'||createHash('sha256').update(bytes).digest('hex')!==i.sha||now()>=i.expiresAt)return false
   // Atomic RPC repeats current authority+lease checks while locking relevant rows.
   const result=await bounded(()=>d.rpc.rpc('character_production_upload_finalize',{p_job:job,p_sha:i.sha,p_bytes:i.bytes}));return !result.error&&result.data===true
  }catch{return false}},
 }
}
