import {createHash} from 'node:crypto'
import {renderedAudioDigest,renderedAudioPath} from './character-production-rendered-audio.ts'
import type {RenderedAudioBinding} from './character-production-rendered-audio.ts'
const bucket='character-production-audio',cap=32*1024*1024,ttl=300
/** Installed Supabase Storage JS contracts; existing backend client only. No
 * uploads, public links, bucket mutations, credentials or retry configuration. */
export interface PrivateAudioStorage {
 getBucket(id:string):PromiseLike<{data:{id:string;public:boolean;file_size_limit?:number|null;allowed_mime_types?:string[]|null}|null;error:unknown}>;
 from(id:string):{
  download(path:string,options:Record<string,never>,parameters:{signal:AbortSignal;cache:'no-store';redirect:'error'}):{asStream():PromiseLike<{data:ReadableStream<Uint8Array>|null;error:unknown}>};
  createSignedUrl(path:string,expiresIn:number):PromiseLike<{data:{signedUrl:string}|null;error:unknown}>;
 }
}
export function createPrivateRenderedAudioSource(sdk:PrivateAudioStorage,origin:string,receipts:readonly RenderedAudioBinding[],timeoutMs=8000){
 const u=new URL(origin)
 if(u.origin!==origin||u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.endsWith('.supabase.co')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid private audio configuration')
 const proofs=new Map<string,RenderedAudioBinding>(),pending=new Set<Promise<unknown>>()
 for(const input of receipts){renderedAudioDigest(input);const b=Object.freeze({...input}),path=renderedAudioPath(b);const previous=proofs.get(path);if(previous&&(previous.audioBytes!==b.audioBytes||previous.mime!==b.mime))throw Error('Conflicting audio object proof');proofs.set(path,b)}
 async function bounded<T>(signal:AbortSignal,action:(signal:AbortSignal)=>Promise<T>){
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
  let timer:ReturnType<typeof setTimeout>|undefined
  const task=Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error('Audio read aborted');return action(controller.signal)})
  pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task))
  try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Private audio operation unconfirmed'))},timeoutMs)})])}finally{clearTimeout(timer);controller.abort();signal.removeEventListener('abort',abort)}
 }
 async function read(path:string,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>{
  const proof=proofs.get(path);if(!proof||maxBytes!==proof.audioBytes)throw Error('Unbound audio path or size')
  return bounded(signal,async signal=>{
   const metadata=await sdk.getBucket(bucket),b=metadata.data
   if(signal.aborted||metadata.error||!b||b.id!==bucket||b.public!==false||!Number.isSafeInteger(b.file_size_limit)||b.file_size_limit!<proof.audioBytes||b.file_size_limit!>cap||!Array.isArray(b.allowed_mime_types)||!b.allowed_mime_types.includes(proof.mime)||b.allowed_mime_types.length<1||b.allowed_mime_types.length>2||b.allowed_mime_types.some(m=>!['audio/mpeg','audio/wav'].includes(m)))throw Error('Private audio bucket policy rejected')
   const result=await sdk.from(bucket).download(path,{}, {signal,cache:'no-store',redirect:'error'}).asStream()
   if(signal.aborted||result.error||!result.data){if(result.data)void result.data.cancel().catch(()=>{});throw Error('Audio stream unavailable')}
   const reader=result.data.getReader(),parts:Uint8Array[]=[];let length=0
   const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true})
   try{while(true){const p=await reader.read();if(signal.aborted)throw Error('Audio expired');if(p.done)break;if(!(p.value instanceof Uint8Array)||parts.length>=4096)throw Error('Invalid stream');length+=p.value.length;if(length>proof.audioBytes)throw Error('Audio exceeds bound');parts.push(Uint8Array.from(p.value))}
    const bytes=Buffer.concat(parts,length),ascii=(a:number,z:number)=>bytes.subarray(a,z).toString('ascii')
    const typeOk=proof.mime==='audio/wav'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE':ascii(0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0
    if(length!==proof.audioBytes||!typeOk||createHash('sha256').update(bytes).digest('hex')!==proof.audioSha256)throw Error('Audio readback mismatch')
    return bytes
   }finally{signal.removeEventListener('abort',cancel);cancel()}
  })
 }
 return {origin,read,
  async sign(path:string,signal:AbortSignal){
   const proof=proofs.get(path);if(!proof)throw Error('Unbound audio path')
   // Re-read immediately before granting access; cached success is never proof.
   await read(path,proof.audioBytes,signal)
   return bounded(signal,async signal=>{
    const r=await sdk.from(bucket).createSignedUrl(path,ttl)
    if(signal.aborted||r.error||!r.data)throw Error('Audio signing unconfirmed')
    const signed=new URL(r.data.signedUrl)
    if(signed.origin!==origin||signed.pathname!=='/storage/v1/object/sign/'+bucket+'/'+path||signed.hash||signed.username||signed.password||signed.search.length>16384||!signed.searchParams.get('token')||[...signed.searchParams.keys()].some(k=>k!=='token'))throw Error('Audio signing scope mismatch')
    return signed.href
   })
  },
  async whenSettled(){while(pending.size)await Promise.allSettled([...pending])},
 }
}
