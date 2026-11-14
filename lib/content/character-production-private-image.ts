import {canonicalImageDigest,canonicalImagePath,verifyCanonicalImage} from './character-production-canonical-image.ts'
import type {CanonicalImageBinding} from './character-production-canonical-image.ts'
const bucket='cafe-sativa-characters',cap=10*1024*1024,ttl=300
/** Installed Supabase Storage JS contracts; existing backend client only. No
 * uploads, public links, bucket mutations, credentials or retry configuration. */
export interface PrivateImageStorage {
 getBucket(id:string):PromiseLike<{data:{id:string;public:boolean;file_size_limit?:number|null;allowed_mime_types?:string[]|null}|null;error:unknown}>;
 from(id:string):{
  download(path:string,options:Record<string,never>,parameters:{signal:AbortSignal;cache:'no-store';redirect:'error'}):{asStream():PromiseLike<{data:ReadableStream<Uint8Array>|null;error:unknown}>};
  createSignedUrl(path:string,expiresIn:number):PromiseLike<{data:{signedUrl:string}|null;error:unknown}>;
 }
}
export function createPrivateCanonicalImageSource(sdk:PrivateImageStorage,origin:string,receipts:readonly CanonicalImageBinding[],timeoutMs=8000){
 const u=new URL(origin)
 if(u.origin!==origin||u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.endsWith('.supabase.co')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid private image configuration')
 const proofs=new Map<string,CanonicalImageBinding>(),pending=new Set<Promise<unknown>>()
 for(const input of receipts){canonicalImageDigest(input);const b=Object.freeze({...input}),path=canonicalImagePath(b);const previous=proofs.get(path);if(previous&&(previous.imageBytes!==b.imageBytes||previous.mime!==b.mime))throw Error('Conflicting image object proof');proofs.set(path,b)}
 async function bounded<T>(signal:AbortSignal,action:(signal:AbortSignal)=>Promise<T>){
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
  let timer:ReturnType<typeof setTimeout>|undefined
  const task=Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error('Image read aborted');return action(controller.signal)})
  pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task))
  try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Private image operation unconfirmed'))},timeoutMs)})])}finally{clearTimeout(timer);controller.abort();signal.removeEventListener('abort',abort)}
 }
 async function read(path:string,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>{
  const proof=proofs.get(path);if(!proof||maxBytes!==proof.imageBytes)throw Error('Unbound image path or size')
  return bounded(signal,async signal=>{
   const metadata=await sdk.getBucket(bucket),b=metadata.data
   if(signal.aborted||metadata.error||!b||b.id!==bucket||b.public!==false||!Number.isSafeInteger(b.file_size_limit)||b.file_size_limit!<proof.imageBytes||b.file_size_limit!>cap||!Array.isArray(b.allowed_mime_types)||!b.allowed_mime_types.includes(proof.mime)||b.allowed_mime_types.length!==4||new Set(b.allowed_mime_types).size!==4||b.allowed_mime_types.some(m=>!['image/png','image/jpeg','image/webp','application/json'].includes(m)))throw Error('Private image bucket policy rejected')
   const result=await sdk.from(bucket).download(path,{}, {signal,cache:'no-store',redirect:'error'}).asStream()
   if(signal.aborted||result.error||!result.data){if(result.data)void result.data.cancel().catch(()=>{});throw Error('Image stream unavailable')}
   const reader=result.data.getReader(),parts:Uint8Array[]=[];let length=0
   const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true})
   try{while(true){const p=await reader.read();if(signal.aborted)throw Error('Image expired');if(p.done)break;if(!(p.value instanceof Uint8Array)||parts.length>=4096)throw Error('Invalid stream');length+=p.value.length;if(length>proof.imageBytes)throw Error('Image exceeds bound');parts.push(Uint8Array.from(p.value))}
    const bytes=Buffer.concat(parts,length)
    if(!verifyCanonicalImage(proof,bytes))throw Error('Image readback mismatch')
    return bytes
   }finally{signal.removeEventListener('abort',cancel);cancel()}
  })
 }
 return {origin,read,
  async sign(path:string,signal:AbortSignal){
   const proof=proofs.get(path);if(!proof)throw Error('Unbound image path')
   // Re-read immediately before granting access; cached success is never proof.
   await read(path,proof.imageBytes,signal)
   return bounded(signal,async signal=>{
    const r=await sdk.from(bucket).createSignedUrl(path,ttl)
    if(signal.aborted||r.error||!r.data)throw Error('Image signing unconfirmed')
    const signed=new URL(r.data.signedUrl)
    if(signed.origin!==origin||signed.pathname!=='/storage/v1/object/sign/'+bucket+'/'+path||signed.hash||signed.username||signed.password||signed.search.length>16384||!signed.searchParams.get('token')||[...signed.searchParams.keys()].some(k=>k!=='token'))throw Error('Image signing scope mismatch')
    return signed.href
   })
  },
  async whenSettled(){while(pending.size)await Promise.allSettled([...pending])},
 }
}
