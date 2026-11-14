import type {createDirectHeyGenApi} from './character-production-heygen-direct.ts'
import type {ApprovedAvatar,HeyGenConfig} from './character-production-provider-heygen.ts'
import {renderedAudioDigest} from './character-production-rendered-audio.ts'
import type {RenderedAudioBinding} from './character-production-rendered-audio.ts'
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
function page(raw:unknown){
 if(!object(raw)||raw.error||raw.has_more!==false||!Array.isArray(raw.data)||raw.data.length>50||raw.data.some(x=>!object(x)))throw Error('Incomplete direct inventory')
 return raw.data as Record<string,unknown>[]
}
/** Direct API data arrays only. No connector envelope conversion. Incomplete
 * first pages hold safely; exact expected account username must be operator-bound.
 * Native voices and trusted rendered-audio proofs are distinct authorization modes. */
export function createDirectHeyGenBindingVerifier(api:ReturnType<typeof createDirectHeyGenApi>,config:Pick<HeyGenConfig,'model'>,expectedUsername:string,audio:readonly RenderedAudioBinding[]=[]){
 if(!expectedUsername||expectedUsername.length>240)throw Error('Expected direct account required')
 const proofs=audio.map(x=>Object.freeze({...x}));proofs.forEach(renderedAudioDigest)
 return async(binding:ApprovedAvatar)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
  try{
   const [account,raw]=await Promise.all([api.account(controller.signal),api.looks(controller.signal)])
   if(!object(account)||account.error||!object(account.data)||account.data.username!==expectedUsername)return false
   const matches=page(raw).filter(v=>v.id===binding.avatarId)
   if(matches.length!==1)return false
   const look=matches[0]
   if(look.status!=='completed'||look.error||look.error_code||look.error_message||!Array.isArray(look.supported_api_engines)||!look.supported_api_engines.includes(config.model))return false
   if(binding.audioBindingSha256){
    const found=proofs.filter(p=>renderedAudioDigest(p)===binding.audioBindingSha256&&p.characterId===binding.characterId&&p.avatarId===binding.avatarId&&p.voiceId===binding.voiceId&&p.canonicalRevision===binding.canonicalRevision&&p.portraitSha256===binding.portraitSha256)
    return !controller.signal.aborted&&found.length===1
   }
   const voices=page(await api.voices(controller.signal)).filter(v=>v.voice_id===binding.voiceId)
   return !controller.signal.aborted&&voices.length===1&&voices[0].status==='ACTIVE'&&!voices[0].error&&!voices[0].error_code
  }catch{return false}finally{clearTimeout(timer);controller.abort()}
 }
}
