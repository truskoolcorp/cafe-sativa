import {createHash} from 'node:crypto'
import {boundedOperationBytes} from './character-production-included-speech-operation-io'
import {includedSpeechLimits} from './character-production-included-speech-operation'
import {verifyFreshIncludedSpeechReceipt} from './character-production-fresh-speech-receipt'
export type PersistedFreshTextIdentity=Readonly<{textAttemptKey:string;textAttemptToken:string;textSourceDigest:string;scriptSha256:string}>
/** Existing authenticated Storage SDK, deliberately excludes upload/sign/list. */
export interface FreshReceiptStorage {
 getBucket(id:string):PromiseLike<{data:any;error:unknown}>;
 from(id:string):{download(path:string,options:Record<string,never>,parameters:{signal:AbortSignal;cache:'no-store';redirect:'error'}):{asStream():PromiseLike<{data:ReadableStream<Uint8Array>|null;error:unknown}>}};
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const hex=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
const bucket='cafe-sativa-characters',audioBucket='character-production-audio'
/** Call only with identity read from the trusted persisted saved text attempt.
 * This is recovery, not current authorization. It accepts neither an operation,
 * owner lease, caller storage path nor URL, and cannot synthesize or write.
 * Drain whenSettled before releasing admission even after abort/SDK failure. */
export function createFreshSpeechReceiptReader(identity:PersistedFreshTextIdentity,d:{storage:FreshReceiptStorage;signal:AbortSignal;enabled:()=>boolean;timeoutMs?:number}){
 const e=structuredClone(identity),ms=d.timeoutMs??30000
 if(!e||Object.keys(e).sort().join(',')!=='scriptSha256,textAttemptKey,textAttemptToken,textSourceDigest'||!/^daily:\d{4}-\d{2}-\d{2}:zaria-solenne$/.test(e.textAttemptKey)||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(e.textAttemptToken)||!hex(e.textSourceDigest)||!hex(e.scriptSha256)||!Number.isSafeInteger(ms)||ms<1||ms>85000)throw Error('persisted_text_identity_unconfirmed')
 const key='fresh-zaria-'+hash(JSON.stringify([e.textAttemptKey,e.textAttemptToken,e.scriptSha256])),root='production-speech-operations/'+key
 const signal=AbortSignal.any([d.signal,AbortSignal.timeout(ms)]),pending=new Set<Promise<unknown>>()
 const check=()=>{signal.throwIfAborted();if(!d.enabled())throw Error('receipt_recovery_disabled')}
 function track<T>(p:Promise<T>){pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p}
 function call<T>(f:()=>PromiseLike<T>){return track(Promise.resolve().then(()=>{check();return f()}))}
 async function preflight(){
  check();const [a,b]=await Promise.all([call(()=>d.storage.getBucket(bucket)),call(()=>d.storage.getBucket(audioBucket))]);check();const x=a.data,y=b.data
  if(a.error||b.error||!x||x.id!==bucket||x.public!==false||x.file_size_limit!==10485760||!Array.isArray(x.allowed_mime_types)||[...x.allowed_mime_types].sort().join(',')!=='application/json,image/jpeg,image/png,image/webp'||!y||y.id!==audioBucket||y.public!==false||y.file_size_limit!==8388608||!Array.isArray(y.allowed_mime_types)||[...y.allowed_mime_types].sort().join(',')!=='audio/mpeg,audio/wav')throw Error('private_policy_unconfirmed')
 }
 async function read(id:string,path:string,max:number){
  check();const r=await call(()=>d.storage.from(id).download(path,{}, {signal,cache:'no-store',redirect:'error'}).asStream())
  if(r.error||!r.data){if(r.data)await track(r.data.cancel().catch(()=>{}));throw Error('read_unconfirmed')}
  try{check()}catch(e){await track(r.data.cancel().catch(()=>{}));throw e}
  const bytes=await track(boundedOperationBytes(r.data,max,signal));check();return bytes
 }
 let originalAudio:{sha:string;bytes:number}|undefined,used=false,closing=false
 const store={preflight,readClaim:()=>read(bucket,root+'/claim.json',16384),readReceipt:()=>read(bucket,root+'/receipt.json',16384),async readProviderReceipt(){
  const bytes=await read(bucket,root+'/provider-receipt.json',16384),p=JSON.parse(bytes.toString('utf8'))
  if(p.key!==key||!hex(p.audioSha256)||!Number.isSafeInteger(p.audioBytes)||p.audioBytes<12||p.audioBytes>includedSpeechLimits.maxBytes)throw Error('original_audio_identity_unconfirmed')
  if(originalAudio&&(originalAudio.sha!==p.audioSha256||originalAudio.bytes!==p.audioBytes))throw Error('original_audio_changed')
  originalAudio={sha:p.audioSha256,bytes:p.audioBytes};return bytes
 },async readAudio(sha:string,size:number){
  if(!originalAudio||sha!==originalAudio.sha||size!==originalAudio.bytes)throw Error('original_audio_required')
  return read(audioBucket,'audio/'+originalAudio.sha+'.mp3',originalAudio.bytes)
 }}
 return {recover(){if(closing)throw Error('receipt_recovery_closed');if(used)throw Error('receipt_recovery_consumed');used=true;return track(Promise.resolve().then(()=>{check();return verifyFreshIncludedSpeechReceipt({...e,key},store,signal)}))},async whenSettled(){closing=true;while(pending.size)await Promise.allSettled([...pending])}}
}
