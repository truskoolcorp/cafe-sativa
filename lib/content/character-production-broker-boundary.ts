import {createHash,timingSafeEqual} from 'node:crypto'
import {createStreamingQaStorage} from './character-production-qa-storage.ts'
import type {StreamingPrivateStorage} from './character-production-qa-storage.ts'
import type {OutputBroker,PrivateOutputBackend,RestrictedSession} from './character-production-scoped.ts'
import type {Pending} from './character-production-engine.ts'
const bucket='character-production-private'
const pathValid=(path:string)=>/^[a-f0-9]{64}\/[a-f0-9]{64}\.mp4$/.test(path)
/** Reuses verified installed Supabase streaming API; no broad key creation.
 * SDK fetch must independently forbid redirects and automatic upload retries. */
export function createPrivateOutputStorage(sdk:StreamingPrivateStorage,timeoutMs=15000):PrivateOutputBackend {
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid storage deadline')
 const reads=createStreamingQaStorage(sdk,timeoutMs)
 return {
  async privateBucket(){const r=await reads.getBucket(bucket);return !r.error&&r.data?.id===bucket&&r.data.public===false},
  async read(path,max){if(!pathValid(path))throw Error('Invalid output path');const r=await reads.from(bucket).download(path,max);if(r.error||!r.data)throw Error('Private output unavailable');return r.data},
  async insert(path,input){
   if(!pathValid(path)||!(input instanceof Uint8Array)||input.length<16||input.length>35*1024*1024)throw Error('Invalid private output')
   const bytes=Uint8Array.from(input)
   if(path.split('/')[1]!==createHash('sha256').update(bytes).digest('hex')+'.mp4'||Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw Error('Output binding mismatch')
   let timer:ReturnType<typeof setTimeout>|undefined
   try{
    const r=await Promise.race([Promise.resolve().then(()=>sdk.from(bucket).upload(path,bytes,{contentType:'video/mp4',upsert:false})),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Output insert unconfirmed')),timeoutMs)})])
    if(r.error)throw Error('Output insert unconfirmed')
   }finally{if(timer)clearTimeout(timer)}
  },
 }
}
/** Uses the accompanying reviewed SQL proposal, NOT assumed installed RPCs.
 * Session is a separately provisioned broker-only role. No dynamic SQL or retry. */
export function createBrokerAuthorization(session:RestrictedSession){return async(job:Readonly<Pending>)=>{
 try{const r=await session.query('SELECT public.character_production_broker_authorized($1) AS value',[structuredClone(job)]);return r.rows.length===1&&r.rows[0].value===true}catch{return false}
}}
/** Factory only: not mounted anywhere. Separate server-owned bearer secret,
 * never a database/service-role credential. Caller must supply approved HTTPS
 * deployment and disabled-retry transport. Auth precedes body allocation. */
export function createOutputBrokerHandler(broker:OutputBroker,config:{token:string;pathname:string;maxBytes:number;bodyTimeoutMs:number}){
 const {token,pathname,maxBytes,bodyTimeoutMs}=config
 if(token.length<32||token.length>512||!/^[\x21-\x7e]+$/.test(token)||!pathname.startsWith('/')||!Number.isSafeInteger(maxBytes)||maxBytes<16||maxBytes>35*1024*1024||!Number.isSafeInteger(bodyTimeoutMs)||bodyTimeoutMs<1||bodyTimeoutMs>30000)throw Error('Invalid broker boundary configuration')
 const expected=createHash('sha256').update('Bearer '+token).digest();let busy=false
 const reply=(status:number,ok=false)=>Response.json({ok},{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 return async(request:Request):Promise<Response>=>{
  if(new URL(request.url).pathname!==pathname)return reply(404)
  if(request.method!=='POST')return reply(405)
  const auth=request.headers.get('authorization')??''
  if(auth.length>520||!timingSafeEqual(expected,createHash('sha256').update(auth).digest()))return reply(401)
  if(busy)return reply(409)
  busy=true
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined
  try{
   const raw=request.headers.get('x-character-job')??'',sha=request.headers.get('x-content-sha256')??''
   const len=request.headers.get('content-length')
   if(request.headers.get('content-type')!=='video/mp4'||raw.length>4096||!raw||!/^[a-f0-9]{64}$/.test(sha)||!request.body||request.signal.aborted)return reply(400)
   if(len!==null&&(!/^\d+$/.test(len)||Number(len)>maxBytes||Number(len)<16))return reply(413)
   const job=JSON.parse(raw)
   const keys=['key','token','digest','taskId','provider','model','providerBindingRevision']
   if(!job||typeof job!=='object'||Object.keys(job).length!==keys.length||keys.some(k=>typeof job[k]!=='string'))return reply(400)
   reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0
   const read=async()=>{while(true){const part=await reader!.read();if(request.signal.aborted)throw Error('Request aborted');if(part.done)break;if(!(part.value instanceof Uint8Array)||chunks.length>=4096)throw Error('Invalid body');size+=part.value.length;if(size>maxBytes)throw Error('Body cap');chunks.push(Uint8Array.from(part.value))}}
   await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader?.cancel().catch(()=>{});reject(Error('Body deadline'))},bodyTimeoutMs)})]);clearTimeout(timer)
   if(request.signal.aborted||size<16||(len!==null&&size!==Number(len)))return reply(400)
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
   const ok=await broker.save(job,{bytes,mime:'video/mp4',sha256:sha})
   return reply(ok?200:409,ok)
  }catch{return reply(400)}finally{clearTimeout(timer);if(reader)void reader.cancel().catch(()=>{});busy=false}
 }
}
