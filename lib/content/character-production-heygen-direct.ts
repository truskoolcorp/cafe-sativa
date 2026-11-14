import type {HeyGenTransport,HeyGenCodecs} from './character-production-provider-heygen.ts'
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(v)
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid HeyGen API object');return v as Record<string,unknown>}
function data(raw:unknown){const r=object(raw);if(r.error!==undefined&&r.error!==null)throw Error('HeyGen API error');return object(r.data)}
export const directHeyGenCodecs:HeyGenCodecs={
 receipt(raw){const d=data(raw);if(!id(d.video_id)||!['waiting','pending','processing'].includes(String(d.status))||d.output_format!==undefined&&d.output_format!=='mp4'||d.resolution!==undefined&&d.resolution!==null&&d.resolution!=='1080p'||d.resolution_note)throw Error('Unverified HeyGen creation receipt');return {taskId:d.video_id}},
 status(raw){const d=data(raw);if(!id(d.id))throw Error('Invalid video identity');if(d.status==='pending'||d.status==='processing')return {taskId:d.id,state:'pending'};if(d.status==='failed')return {taskId:d.id,state:'failed'};if(d.status!=='completed'||typeof d.video_url!=='string'||!d.video_url.startsWith('https://')||d.error_code||d.error_message)throw Error('Invalid completed video');return {taskId:d.id,state:'completed',mediaUrl:d.video_url}},
}
/** Fixed-host HTTP client. Existing backend env accessor supplied by caller;
 * never logs key/body/raw error. Native fetch does not retry. No arbitrary URL. */
export function createDirectHeyGenApi(key:()=>string|undefined,fetcher:typeof fetch=fetch,timeoutMs=8000){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid API deadline')
 async function call(path:string,signal:AbortSignal,body?:unknown){
  const secret=key();if(!secret||secret.length>4096||/[\r\n]/.test(secret))throw Error('HeyGen API key unavailable')
  const c=new AbortController(),abort=()=>c.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)c.abort()
  let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([(async()=>{
   if(c.signal.aborted)throw Error('HeyGen request aborted')
   const r=await fetcher('https://api.heygen.com'+path,{method:body?'POST':'GET',headers:{'X-Api-Key':secret,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:c.signal,redirect:'error',cache:'no-store'})
   if(r.status!==200||!r.headers.get('content-type')?.toLowerCase().includes('application/json')||!r.body)throw Error('HeyGen API request unavailable')
   const reader=r.body.getReader();const chunks:Uint8Array[]=[];let size=0
   try{while(true){const p=await reader.read();if(c.signal.aborted)throw Error('HeyGen response expired');if(p.done)break;size+=p.value.length;if(size>1_000_000||chunks.length>=4096)throw Error('HeyGen response exceeds bound');chunks.push(p.value)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}finally{void reader.cancel().catch(()=>{})}
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('HeyGen request unconfirmed'))},timeoutMs)})])}finally{clearTimeout(timer);c.abort();signal.removeEventListener('abort',abort)}
 }
 return {
  /** Inventory only; current API lists use data arrays, NOT connector items. */
  account:(signal:AbortSignal)=>call('/v3/users/me',signal),
  looks:(signal:AbortSignal)=>call('/v3/avatars/looks?ownership=private&limit=50',signal),
  voices:(signal:AbortSignal)=>call('/v3/models/audio/voices?type=private&limit=50',signal),
  video:(videoId:string,signal:AbortSignal)=>{if(!id(videoId))throw Error('Invalid video ID');return call('/v3/videos/'+encodeURIComponent(videoId),signal)},
  /** This writer must only be composed behind existing ledger authorization.
   * Explicit native voice allowlist prevents treating ElevenLabs IDs as native. */
  transport(accountBinding:string,nativeVoiceIds:readonly string[]):HeyGenTransport {
   if(!id(accountBinding)||nativeVoiceIds.some(v=>!id(v)))throw Error('Invalid direct binding')
   const voices=new Set(nativeVoiceIds)
   return {
    create_video_from_avatar(args,signal){
     if(args.link_id!==accountBinding||!voices.has(args.voiceId)||!id(args.avatarId)||!args.script.trim()||args.script.length>5000||!['avatar_v','avatar_iv','avatar_iii','heygen-avatar-6','heygen-avatar-6-turbo'].includes(args.engine.type)||!['9:16','16:9'].includes(args.aspectRatio)||args.outputFormat!=='mp4'||args.resolution!=='1080p')throw Error('Direct canonical native binding not authorized')
     return call('/v3/videos',signal,{type:'avatar',avatar_id:args.avatarId,voice_id:args.voiceId,script:args.script,engine:{type:args.engine.type},aspect_ratio:args.aspectRatio,output_format:'mp4',resolution:'1080p'})
    },
    get_video(args,signal){if(args.link_id!==accountBinding||!id(args.videoId))throw Error('Wrong direct account binding');return call('/v3/videos/'+encodeURIComponent(args.videoId),signal)},
   }
  },
 }
}
/** Sanitized, explicitly incomplete inventory, not a canonical binding verifier. */
export async function inspectDirectHeyGen(api:ReturnType<typeof createDirectHeyGenApi>){
 const c=new AbortController();try{
  const [user,looks,voices]=await Promise.all([api.account(c.signal),api.looks(c.signal),api.voices(c.signal)])
  const u=data(user)
  function list(raw:unknown,kind:'look'|'voice'){
   const r=object(raw);if(r.error||!Array.isArray(r.data)||r.data.length>50||typeof r.has_more!=='boolean')throw Error('Unverified inventory envelope')
   return {complete:!r.has_more,items:r.data.map(x=>{const v=object(x);const key=kind==='look'?v.id:v.voice_id;if(!id(key)||typeof v.status!=='string')throw Error('Unverified inventory identity');return {id:key,status:v.status,...(kind==='look'?{engines:Array.isArray(v.supported_api_engines)?v.supported_api_engines.filter(x=>typeof x==='string'):[]}:{})}})}
  }
  const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null
  let billing:Record<string,unknown>={type:u.billing_type,verified:false}
  if(u.billing_type==='wallet'){const w=object(u.wallet);billing={type:'wallet',currency:w.currency,remaining:finite(w.remaining_balance),verified:finite(w.remaining_balance)!==null}}
  else if(u.billing_type==='usage_based'){const w=object(u.usage_based);billing={type:'usage_based',remainingCredits:finite(w.remaining_credits),spendingCapUsd:finite(w.spending_cap_usd),verified:finite(w.remaining_credits)!==null}}
  else if(u.billing_type==='subscription'){const credits=object(object(u.subscription).credits);billing={type:'subscription',premium:finite(object(credits.premium_credits).remaining),addOn:finite(object(credits.add_on_credits).remaining),verified:finite(object(credits.premium_credits).remaining)!==null&&finite(object(credits.add_on_credits).remaining)!==null}}
  return {account:typeof u.username==='string'?u.username:null,billing,looks:list(looks,'look'),voices:list(voices,'voice'),canonicalBindingVerified:false,spendAuthorized:false}
 }finally{c.abort()}
}
