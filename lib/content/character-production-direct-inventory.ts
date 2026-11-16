import type {createDirectHeyGenApi} from './character-production-heygen-direct.ts'
import type {ApprovedAvatar,HeyGenConfig} from './character-production-provider-heygen.ts'
import {renderedAudioDigest} from './character-production-rendered-audio.ts'
import type {RenderedAudioBinding} from './character-production-rendered-audio.ts'
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
async function scan(read:(signal:AbortSignal,token?:string)=>Promise<unknown>,signal:AbortSignal){
 const all:Record<string,unknown>[]=[],seen=new Set<string>();let token:string|undefined
 for(let count=0;count<10;count++){
  if(signal.aborted)throw Error('Inventory deadline')
  const raw=await read(signal,token)
  if(signal.aborted||!object(raw)||raw.error||typeof raw.has_more!=='boolean'||!Array.isArray(raw.data)||raw.data.length>50||raw.data.some(x=>!object(x)))throw Error('Invalid direct inventory')
  all.push(...raw.data as Record<string,unknown>[])
  if(!raw.has_more)return all
  if(typeof raw.next_token!=='string'||!raw.next_token||raw.next_token.length>2048||seen.has(raw.next_token))throw Error('Invalid inventory cursor')
  token=raw.next_token;seen.add(token)
 }
 throw Error('Incomplete direct inventory')
}
/** Direct API data arrays only. No connector envelope conversion. Incomplete
 * bounded paginated scans hold safely; exact expected account username must be operator-bound.
 * Native voices and trusted rendered-audio proofs are distinct authorization modes. */
export function createDirectHeyGenBindingVerifier(api:ReturnType<typeof createDirectHeyGenApi>,config:Pick<HeyGenConfig,'model'>,expectedUsername:string,audio:readonly RenderedAudioBinding[]=[]){
 if(!expectedUsername||expectedUsername.length>240)throw Error('Expected direct account required')
 const proofs=audio.map(x=>Object.freeze({...x}));proofs.forEach(renderedAudioDigest)
 return async(binding:ApprovedAvatar)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
  try{
   const [account,raw]=await Promise.all([api.account(controller.signal),scan(api.looks,controller.signal)])
   if(!object(account)||account.error||!object(account.data)||account.data.username!==expectedUsername)return false
   const matches=raw.filter(v=>v.id===binding.avatarId)
   if(matches.length!==1)return false
   const look=matches[0]
   if(look.status!=='completed'||look.error||look.error_code||look.error_message||!Array.isArray(look.supported_api_engines)||!look.supported_api_engines.includes(config.model))return false
   if(binding.audioBindingSha256){
    const found=proofs.filter(p=>renderedAudioDigest(p)===binding.audioBindingSha256&&p.characterId===binding.characterId&&p.avatarId===binding.avatarId&&p.voiceId===binding.voiceId&&p.canonicalRevision===binding.canonicalRevision&&p.portraitSha256===binding.portraitSha256)
    return !controller.signal.aborted&&found.length===1
   }
   const voices=(await scan(api.voices,controller.signal)).filter(v=>v.voice_id===binding.voiceId)
   return !controller.signal.aborted&&voices.length===1&&voices[0].status==='ACTIVE'&&!voices[0].error&&!voices[0].error_code
  }catch{return false}finally{clearTimeout(timer);controller.abort()}
 }
}
