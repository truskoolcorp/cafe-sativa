import {createHash} from 'node:crypto'
export const canaryInputs={
 audio:{bucket:'character-production-audio',path:'audio/713540eab3943024d3e998ee692f286fce70693f6df9bc6088ecd825a599c42b.mp3',sha:'713540eab3943024d3e998ee692f286fce70693f6df9bc6088ecd825a599c42b',bytes:146318,mime:'audio/mpeg',cap:8388608},
 image:{bucket:'cafe-sativa-characters',path:'production-inputs/dc56e882a2beffac334927ecfe33b908568cbf2bc49065b0336259fca8fc784e.png',sha:'dc56e882a2beffac334927ecfe33b908568cbf2bc49065b0336259fca8fc784e',bytes:2311086,mime:'image/png',cap:10485760},
} as const
export type CanaryInputKind=keyof typeof canaryInputs
interface Result{data:unknown;error:unknown}
export interface CanaryInputStorage{getBucket(id:string):PromiseLike<Result>;from(id:string):{upload(path:string,bytes:Uint8Array,options:{contentType:string;upsert:false}):PromiseLike<Result>;download(path:string):PromiseLike<{data:Blob|null;error:unknown}>}}
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
async function bounded<T>(p:PromiseLike<T>){let t:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([p,new Promise<never>((_,reject)=>{t=setTimeout(()=>reject(Error('Input storage unconfirmed')),5000)})])}finally{clearTimeout(t)}}
export async function importCanaryInput(kind:CanaryInputKind,bytes:Uint8Array,storage:CanaryInputStorage){
 const b=canaryInputs[kind];if(!b||!(bytes instanceof Uint8Array)||bytes.length!==b.bytes||hash(bytes)!==b.sha)throw Error('Exact authorized input required')
 const meta=await bounded(storage.getBucket(b.bucket));const m=meta.data as {id?:string;public?:boolean;file_size_limit?:number;allowed_mime_types?:string[]}|null
 if(meta.error||m?.id!==b.bucket||m.public!==false||m.file_size_limit!==b.cap||!Array.isArray(m.allowed_mime_types)||!m.allowed_mime_types.includes(b.mime))throw Error('Private input bucket mismatch')
 // Insert-only. No duplicate/unknown result retry or overwrite. A failed response
 // requires independent readback, never a second paid/provider operation.
 const result=await bounded(storage.from(b.bucket).upload(b.path,Uint8Array.from(bytes),{contentType:b.mime,upsert:false}));if(result.error)throw Error('Input upload unconfirmed; inspect before retry')
 const read=await bounded(storage.from(b.bucket).download(b.path));if(read.error||!read.data||read.data.size!==b.bytes)throw Error('Input readback failed')
 const actual=new Uint8Array(await bounded(read.data.arrayBuffer()));if(actual.length!==b.bytes||hash(actual)!==b.sha)throw Error('Input readback mismatch')
 return {stored:true,kind,sha256:b.sha,bytes:b.bytes,private:true,generationStarted:false}
}
