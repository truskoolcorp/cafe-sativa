import {createHash} from 'node:crypto'
import type {SpeechOutputStore} from './character-production-speech.ts'
const bucket='character-production-audio',cap=32*1024*1024
interface Sdk {
 getBucket(id:string):PromiseLike<{data:{id:string;public:boolean;file_size_limit?:number|null;allowed_mime_types?:string[]|null}|null;error:unknown}>;
 from(id:string):{
  upload(path:string,bytes:Uint8Array,options:{contentType:'audio/mpeg';upsert:false}):PromiseLike<{error:unknown}>;
  download(path:string,options:Record<string,never>,parameters:{signal:AbortSignal;redirect:'error';cache:'no-store'}):{asStream():PromiseLike<{data:ReadableStream<Uint8Array>|null;error:unknown}>};
 }
}
const valid=(path:string,n:number)=>/^audio\/[a-f0-9]{64}\.mp3$/.test(path)&&Number.isSafeInteger(n)&&n>=12&&n<=cap
function check(path:string,bytes:Uint8Array){if(!valid(path,bytes.length)||createHash('sha256').update(bytes).digest('hex')!==path.slice(6,-4)||(Buffer.from(bytes.subarray(0,3)).toString('ascii')!=='ID3'&&!(bytes[0]===255&&(bytes[1]&224)===224)))throw Error('Invalid immutable speech bytes')}
/** Existing privileged server SDK only. No overwrite, listing, signed/public URL
 * or client-key exposure. Unknown upload is followed by readback, never retry. */
export function createSpeechOutputStore(sdk:Sdk,timeoutMs=8000):SpeechOutputStore&{whenSettled():Promise<void>}{
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid storage deadline')
 const pending=new Set<Promise<unknown>>()
 async function bounded<T>(action:(signal:AbortSignal)=>Promise<T>){const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;const task=Promise.resolve().then(()=>action(c.signal));pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('Speech storage unknown'))},timeoutMs)})])}finally{clearTimeout(timer);c.abort()}}
 async function metadata(size:number,signal:AbortSignal){const r=await sdk.getBucket(bucket),b=r.data;if(signal.aborted||r.error||!b||b.id!==bucket||b.public!==false||!Number.isSafeInteger(b.file_size_limit)||b.file_size_limit!<size||b.file_size_limit!>cap||!b.allowed_mime_types?.includes('audio/mpeg')||b.allowed_mime_types.some(m=>!['audio/mpeg','audio/wav'].includes(m)))throw Error('Private audio policy required')}
 return {
  async insert(path,bytes){check(path,bytes);const copy=Uint8Array.from(bytes);await bounded(async signal=>{await metadata(copy.length,signal);if(signal.aborted)throw Error('Expired');const r=await sdk.from(bucket).upload(path,copy,{contentType:'audio/mpeg',upsert:false});if(signal.aborted||r.error)throw Error('Insert unconfirmed')})},
  async read(path,size){if(!valid(path,size))throw Error('Unbound speech path');return bounded(async signal=>{await metadata(size,signal);const r=await sdk.from(bucket).download(path,{}, {signal,redirect:'error',cache:'no-store'}).asStream();if(signal.aborted||r.error||!r.data){if(r.data)void r.data.cancel().catch(()=>{});throw Error('Read unavailable')};const reader=r.data.getReader(),parts:Uint8Array[]=[];let n=0;const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});try{while(true){const p=await reader.read();if(signal.aborted)throw Error('Expired');if(p.done)break;n+=p.value.length;if(n>size||parts.length>=4096)throw Error('Read exceeds bound');parts.push(Uint8Array.from(p.value))}if(n!==size)throw Error('Wrong length');const bytes=Buffer.concat(parts,n);check(path,bytes);return bytes}finally{signal.removeEventListener('abort',cancel);cancel()}})},
  async whenSettled(){while(pending.size)await Promise.allSettled([...pending])},
 }
}
