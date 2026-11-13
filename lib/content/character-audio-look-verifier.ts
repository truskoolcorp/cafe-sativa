import {performance} from 'node:perf_hooks'
export type AudioLookBinding=Readonly<{linkId:string;lookId:string;groupId:string;model:string}>
export interface AudioLookReader {get_avatar_look(args:Readonly<{link_id:string;lookId:string}>,signal:AbortSignal):Promise<unknown>}
const id=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(s)
export type LookInspection={available:boolean;reason:'ready'|'identity-mismatch'|'not-completed'|'provider-error'|'model-capability-unverified'|'model-unsupported'}
/** Inspection is diagnostic only, never a grant to synthesize or render. Missing
 * capability metadata cannot be inferred from completed training or a prior video. */
export function inspectAudioLook(look:Record<string,unknown>,binding:AudioLookBinding):LookInspection {
 if(look.id!==binding.lookId||look.group_id!==binding.groupId)return {available:false,reason:'identity-mismatch'}
 if(look.status!=='completed')return {available:false,reason:'not-completed'}
 if([look.error,look.error_code,look.error_message].some(v=>v!==null&&v!==undefined))return {available:false,reason:'provider-error'}
 if(!Array.isArray(look.supported_api_engines)||look.supported_api_engines.some(v=>typeof v!=='string'))return {available:false,reason:'model-capability-unverified'}
 if(!look.supported_api_engines.includes(binding.model))return {available:false,reason:'model-unsupported'}
 return {available:true,reason:'ready'}
}
/** Availability only. NOT ownership, image approval, audio provenance, or budget
 * approval. No HeyGen voice lookup: ElevenLabs audio has separate provenance. */
export function createAudioLookReadinessVerifier(input:AudioLookBinding,reader:AudioLookReader,timeoutMs=8000):()=>Promise<boolean>{
 const binding=Object.freeze({...input}),read=reader.get_avatar_look.bind(reader)
 return async()=>{
  if(!Object.values(binding).every(id)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)return false
  const controller=new AbortController(),until=performance.now()+timeoutMs
  let timer:ReturnType<typeof setTimeout>|undefined
  const current=()=>{if(controller.signal.aborted||performance.now()>=until)throw Error('Readiness deadline')}
  try{return await Promise.race([
   Promise.resolve().then(async()=>{
    current();const raw=await read(Object.freeze({link_id:binding.linkId,lookId:binding.lookId}),controller.signal);current()
    if(!raw||typeof raw!=='object')return false
    const r=raw as Record<string,unknown>
    if(r.isError!==false||!Array.isArray(r.content)||r.content.length<1||r.content.length>8)return false
    let bytes=0;const docs:unknown[]=[]
    for(const c of r.content){
     if(!c||typeof c!=='object'||c.type!=='text'||typeof c.text!=='string')return false
     bytes+=Buffer.byteLength(c.text);if(bytes>1_000_000)return false
     const t=c.text.trim();if(t.startsWith('{')||t.startsWith('['))docs.push(JSON.parse(t))
    }
    if(docs.length!==1||!docs[0]||typeof docs[0]!=='object'||Array.isArray(docs[0]))return false
    const look=docs[0] as Record<string,unknown>;current()
    return inspectAudioLook(look,binding).available
   }),new Promise<boolean>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(false)},timeoutMs)}),
  ])}catch{return false}finally{clearTimeout(timer);controller.abort()}
 }
}
