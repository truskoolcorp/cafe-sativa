import {performance} from 'node:perf_hooks'
import type {QaBridgeObjects} from './character-production-qa-bridge.ts'

/** Supabase Storage JS 2.104.0 streaming interface. Inject an existing authorized
 * server client; this module never creates credentials or changes permissions. */
export interface StreamingPrivateStorage {
 getBucket(id:string):PromiseLike<{data:{id:string;public:boolean}|null;error:unknown}>
 from(id:string):{
  download(path:string,options:Record<string,never>,parameters:{signal:AbortSignal;cache:'no-store';redirect:'error'}):{
   asStream():PromiseLike<{data:ReadableStream<Uint8Array>|null;error:unknown}>
  }
  upload(path:string,bytes:Uint8Array,options:{contentType:'video/mp4';upsert:false}):PromiseLike<{error:unknown}>
 }
}
const allowed=new Set(['character-production-private','cafe-sativa-content'])
function pathAllowed(bucket:string,path:string){
 return bucket==='character-production-private'?/^[a-f0-9]{64}\/[a-f0-9]{64}\.mp4$/.test(path):
 bucket==='cafe-sativa-content'&&/^character-promos\/[A-Za-z0-9][A-Za-z0-9_-]{0,239}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{64}\.mp4$/.test(path)
}
export function createStreamingQaStorage(sdk:StreamingPrivateStorage,timeoutMs=15000):QaBridgeObjects {
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid storage deadline')
 async function bounded<T>(action:(signal:AbortSignal,deadline:number)=>PromiseLike<T>):Promise<T>{
  const c=new AbortController(),deadline=performance.now()+timeoutMs
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   const value=await Promise.race([Promise.resolve().then(()=>action(c.signal,deadline)),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{c.abort();reject(Error('Private storage operation unconfirmed'))},timeoutMs)
   })])
   if(performance.now()>=deadline)throw Error('Private storage deadline exceeded')
   return value
  }finally{if(timer)clearTimeout(timer);c.abort()}
 }
 return {
  getBucket(id){if(!allowed.has(id))throw Error('Unexpected private bucket');return bounded(()=>sdk.getBucket(id))},
  from(bucket){
   if(!allowed.has(bucket))throw Error('Unexpected private bucket')
   return {
    async download(path,maxBytes){
     if(!pathAllowed(bucket,path)||!Number.isSafeInteger(maxBytes)||maxBytes<16||maxBytes>35*1024*1024)throw Error('Invalid private download')
     return bounded(async(signal,deadline)=>{
      const builder=sdk.from(bucket).download(path,{}, {signal,cache:'no-store',redirect:'error'})
      if(!builder||typeof builder.asStream!=='function')throw Error('Streaming storage capability required')
      const result=await builder.asStream()
      if(result.error||!result.data||signal.aborted||performance.now()>=deadline){
       if(result.data)void result.data.cancel().catch(()=>{})
       throw Error('Private stream unavailable')
      }
      const reader=result.data.getReader(),chunks:Uint8Array[]=[]
      let size=0
      const cancel=()=>{void reader.cancel().catch(()=>{})}
      signal.addEventListener('abort',cancel,{once:true})
      try{
       while(true){
        const part=await reader.read()
        if(signal.aborted||performance.now()>=deadline)throw Error('Private stream expired')
        if(part.done)break
        if(!(part.value instanceof Uint8Array)||chunks.length>=4096)throw Error('Invalid private stream')
        size+=part.value.byteLength
        if(size>maxBytes)throw Error('Private stream exceeds byte cap')
        chunks.push(Uint8Array.from(part.value))
       }
       const bytes=new Uint8Array(size);let offset=0
       for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
       return {data:bytes,error:null}
      }finally{signal.removeEventListener('abort',cancel);cancel()}
     })
    },
    upload(path,bytes,options){
     if(bucket!=='cafe-sativa-content'||!pathAllowed(bucket,path)||!(bytes instanceof Uint8Array)||bytes.length<16||bytes.length>35*1024*1024||options.upsert!==false||options.contentType!=='video/mp4')throw Error('Invalid private copy')
     const copy=Uint8Array.from(bytes)
     // Timeout is uncertain, never an instruction to retry an upload.
     return bounded(()=>sdk.from(bucket).upload(path,copy,{contentType:'video/mp4',upsert:false}))
    },
   }
  },
 }
}
