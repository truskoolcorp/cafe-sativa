import {includedSpeechLimits,validateIncludedSpeechOperation,includedOperationQuota,type IncludedSpeechOperation,type IncludedOperationStore} from './character-production-included-speech-operation.ts'
const bucket='cafe-sativa-characters',audioBucket='character-production-audio'
export async function boundedOperationBytes(stream:ReadableStream<Uint8Array>,max:number,signal:AbortSignal){
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let n=0
 let cancellation:Promise<void>|undefined
 const cancel=()=>{cancellation??=reader.cancel().catch(()=>{});return cancellation};signal.addEventListener('abort',cancel,{once:true})
 try{while(true){if(signal.aborted)throw Error('cancelled');const x=await reader.read();if(signal.aborted)throw Error('cancelled');if(x.done)break;if(!(x.value instanceof Uint8Array)||chunks.length>=4096)throw Error('stream_unconfirmed');n+=x.value.length;if(n>max)throw Error('size_exceeded');chunks.push(Uint8Array.from(x.value))}return Buffer.concat(chunks,n)}finally{signal.removeEventListener('abort',cancel);await cancel()}
}
export function createIncludedOperationProvider(input:IncludedSpeechOperation,key:string,signal:AbortSignal,fetcher:typeof fetch=fetch,beforePost:()=>void|Promise<void>=()=>{},beforeDispatch:()=>void=()=>{}){
 const operation=Object.freeze({...input});validateIncludedSpeechOperation(operation)
 if(!key||key.length>4096||/[\r\n]/.test(key))throw Error('provider_unconfigured')
 let posted=false
 const pending=new Set<Promise<unknown>>()
 function track<T>(task:Promise<T>){pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task}
 async function performRequest(path:string,body?:unknown){
  if(signal.aborted)throw Error('cancelled')
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(body?12000:8000)])
  const r=await track(Promise.resolve().then(async()=>{
   deadline.throwIfAborted();signal.throwIfAborted()
   if(body){if(Date.now()>=operation.expiresAt)throw Error('authority_expired');const checked=beforePost();if(checked)await checked;deadline.throwIfAborted();signal.throwIfAborted();if(Date.now()>=operation.expiresAt)throw Error('authority_expired');beforeDispatch();deadline.throwIfAborted();signal.throwIfAborted()}
   return fetcher('https://api.elevenlabs.io'+path,{method:body?'POST':'GET',headers:{'xi-api-key':key,Accept:body?'audio/mpeg':'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:deadline,cache:'no-store',redirect:'error'})}))
  if(r.status!==200||!r.body){if(r.body)void track(r.body.cancel()).catch(()=>{});throw Error('provider_unconfirmed')}
  const type=r.headers.get('content-type')?.split(';')[0]
  if(type!==(body?'audio/mpeg':'application/json')){void track(r.body.cancel()).catch(()=>{});throw Error('provider_type_unconfirmed')}
  const bytes=await track(boundedOperationBytes(r.body,body?includedSpeechLimits.maxBytes:524288,deadline))
  return {bytes,requestId:r.headers.get('request-id')}
 }
 function request(path:string,body?:unknown){return track(performRequest(path,body))}
 async function inventory(){const [s,m,v]=await Promise.all([request('/v1/user/subscription'),request('/v1/models'),request('/v1/voices/'+operation.voiceId)]);return [JSON.parse(s.bytes.toString('utf8')),JSON.parse(m.bytes.toString('utf8')),JSON.parse(v.bytes.toString('utf8'))]}
 return {async whenSettled(){while(pending.size)await Promise.allSettled([...pending])},async inspect(){const [s,m,v]=await inventory();const model=Array.isArray(m)?m.find((x:any)=>x?.model_id===operation.modelId):null
  const number=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<1e12?x:null
  const boolean=(x:unknown)=>typeof x==='boolean'?x:null
  const facts={remainingCredits:Number.isSafeInteger(s?.character_limit)&&Number.isSafeInteger(s?.character_count)?number(s.character_limit-s.character_count):null,overageEntitled:boolean(s?.can_extend_character_limit),overageCap:s?.max_credit_limit_extension==='unlimited'?'unlimited':number(s?.max_credit_limit_extension),deprecatedAllowed:boolean(s?.allowed_to_extend_character_limit),modelAvailable:model?.can_do_text_to_speech===true,modelCharacterMultiplier:number(model?.model_rates?.character_cost_multiplier),modelDiscountMultiplier:number(model?.model_rates?.cost_discount_multiplier),modelMaxText:number(model?.maximum_text_length_per_request),voiceFound:v?.voice_id===operation.voiceId,voiceCustomRate:number(v?.sharing?.rate),privateGeneratedOrCloned:v?.sharing===null&&['generated','cloned'].includes(v?.category)}
  try{return {ready:true,reason:null,facts,proof:includedOperationQuota(operation,s,m,v),synthesisAttempted:false}}catch(e){const known=new Set(['operation_unverified','included_only_unverified','included_margin_insufficient','canonical_rate_unverified']);return {ready:false,reason:e instanceof Error&&known.has(e.message)?e.message:'preflight_unconfirmed',facts,proof:null,synthesisAttempted:false}}
 },async quota(){const [s,m,v]=await inventory();return includedOperationQuota(operation,s,m,v)},async synthesize(){if(posted)throw Error('already_attempted');posted=true;const [subscription,models,voice]=await inventory();includedOperationQuota(operation,subscription,models,voice);if(signal.aborted||Date.now()>=operation.expiresAt)throw Error('authority_expired');const r=await request('/v1/text-to-speech/'+operation.voiceId+'?output_format='+includedSpeechLimits.format,{text:operation.script,model_id:operation.modelId});if(!r.requestId)throw Error('receipt_unconfirmed');return {bytes:r.bytes,requestId:r.requestId}}}
}
interface Sdk{getBucket(id:string):PromiseLike<{data:any;error:unknown}>;from(id:string):{upload(path:string,bytes:Uint8Array,options:{upsert:false;contentType:string}):PromiseLike<{error:unknown;data:unknown}>;download(path:string,options:Record<string,never>,parameters:{signal:AbortSignal;cache:'no-store';redirect:'error'}):{asStream():PromiseLike<{data:ReadableStream<Uint8Array>|null;error:unknown}>}}}
export function createIncludedOperationStore(input:IncludedSpeechOperation,sdk:Sdk,signal:AbortSignal):IncludedOperationStore{
 const operation=Object.freeze({...input});validateIncludedSpeechOperation(operation)
 const root=`production-speech-operations/${operation.key}`
 async function metadata(){
  const [a,b]=await Promise.all([sdk.getBucket(bucket),sdk.getBucket(audioBucket)])
  const x=a.data,y=b.data
  if(signal.aborted||a.error||b.error||!x||x.id!==bucket||x.public!==false||x.file_size_limit!==10485760||!Array.isArray(x.allowed_mime_types)||[...x.allowed_mime_types].sort().join(',')!=='application/json,image/jpeg,image/png,image/webp'||!y||y.id!==audioBucket||y.public!==false||y.file_size_limit!==8388608||!Array.isArray(y.allowed_mime_types)||[...y.allowed_mime_types].sort().join(',')!=='audio/mpeg,audio/wav')throw Error('private_policy_unconfirmed')
 }
 async function put(id:string,path:string,bytes:Uint8Array,mime:string){if(signal.aborted)throw Error('cancelled');const r=await sdk.from(id).upload(path,bytes,{contentType:mime,upsert:false});if(signal.aborted||r.error||!r.data)throw Error('insert_unconfirmed')}
 async function read(id:string,path:string,max:number){if(signal.aborted)throw Error('cancelled');const r=await sdk.from(id).download(path,{}, {signal,cache:'no-store',redirect:'error'}).asStream();if(r.error||!r.data)throw Error('read_unconfirmed');return boundedOperationBytes(r.data,max,signal)}
 const audioPath=(sha:string)=>{if(!/^[a-f0-9]{64}$/.test(sha))throw Error('invalid_sha');return `audio/${sha}.mp3`}
 return {preflight:metadata,async claim(bytes){if(bytes.length>16384)throw Error('claim_size');await metadata();await put(bucket,root+'/claim.json',bytes,'application/json')},readClaim:()=>read(bucket,root+'/claim.json',16384),async providerReceipt(bytes){if(bytes.length>16384)throw Error('receipt_size');await put(bucket,root+'/provider-receipt.json',bytes,'application/json')},readProviderReceipt:()=>read(bucket,root+'/provider-receipt.json',16384),async audio(bytes,sha){if(bytes.length>includedSpeechLimits.maxBytes)throw Error('audio_size');await metadata();await put(audioBucket,audioPath(sha),bytes,'audio/mpeg')},readAudio:(sha,size)=>read(audioBucket,audioPath(sha),size),async receipt(bytes){if(bytes.length>16384)throw Error('receipt_size');await put(bucket,root+'/receipt.json',bytes,'application/json')},readReceipt:()=>read(bucket,root+'/receipt.json',16384)}
}

