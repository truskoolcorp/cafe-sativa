import {createHash,randomUUID} from 'node:crypto'
import {boundedOperationBytes} from './character-production-included-speech-operation-io.ts'
const bucket='cafe-sativa-characters',sha=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex')
export interface SpeechProbeStorage {
 getBucket(id:string):PromiseLike<{data:{id:string;public:boolean;file_size_limit?:number|null;allowed_mime_types?:string[]|null}|null;error:unknown}>;
 from(id:string):{
  upload(path:string,bytes:Uint8Array,options:{upsert:false;contentType:string}):PromiseLike<{data:unknown;error:unknown}>;
  download(path:string,options:Record<string,never>,parameters:{signal:AbortSignal;cache:'no-store';redirect:'error'}):{asStream():PromiseLike<{data:ReadableStream<Uint8Array>|null;error:unknown}>};
 }
}
/** Harmless new private marker only. Two distinct contenders deliberately test
 * create-if-absent, not retries. No deletion, provider call, credential or real
 * operation claim. Any ambiguous outcome requires read-only reconciliation. */
export async function probeSpeechClaimStorage(sdk:SpeechProbeStorage,signal:AbortSignal,onPrepared:(path:string)=>void=()=>{}){
 if(signal.aborted)throw Error('cancelled')
 const metadata=await sdk.getBucket(bucket),m=metadata.data
 if(signal.aborted||metadata.error||!m||m.id!==bucket||m.public!==false||m.file_size_limit!==10485760||!Array.isArray(m.allowed_mime_types)||[...m.allowed_mime_types].sort().join(',')!=='application/json,image/jpeg,image/png,image/webp')throw Error('private_policy_unconfirmed')
 const id=randomUUID(),path=`production-speech-operations/storage-probe-${id}/claim.json`
 onPrepared(path)
 const payloads=[0,1].map(contender=>Buffer.from(JSON.stringify({version:1,kind:'disposable-storage-atomicity-probe',probeId:id,contender,noSynthesis:true})))
 // Publish the known marker path on ambiguity for read-only reconciliation.
 try{
  const results=await Promise.all(payloads.map(bytes=>sdk.from(bucket).upload(path,bytes,{contentType:'application/json',upsert:false})))
  if(signal.aborted)throw Error('cancelled')
  const success=results.map((r,i)=>!r.error&&r.data?i:-1).filter(i=>i>=0)
  const conflict=results.map((r,i)=>{const e=r.error as {statusCode?:unknown;status?:unknown}|null;return !r.data&&e&&(String(e.statusCode??e.status)==='409')?i:-1}).filter(i=>i>=0)
  if(success.length!==1||conflict.length!==1||success[0]===conflict[0])throw Error('atomic_conflict_unconfirmed')
  const r=await sdk.from(bucket).download(path,{}, {signal,cache:'no-store',redirect:'error'}).asStream()
  if(signal.aborted||r.error||!r.data)throw Error('readback_unconfirmed')
  const bytes=await boundedOperationBytes(r.data,1024,signal)
  if(signal.aborted||bytes.length!==payloads[success[0]].length||sha(bytes)!==sha(payloads[success[0]]))throw Error('winner_readback_mismatch')
  return {status:'verified' as const,bucket,path,sha256:sha(bytes),bytes:bytes.length,successfulCreates:1,explicitConflicts:1,private:true,providerCalls:0,cleanup:'retained_private_probe_evidence'}
 }catch{return {status:'unverified' as const,bucket,path,providerCalls:0,retry:false,next:'read_only_reconciliation'}}
}
