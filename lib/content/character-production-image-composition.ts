import {createHash} from 'node:crypto'
import {createDirectHeyGenApi,directHeyGenCodecs} from './character-production-heygen-direct.ts'
import {canonicalImageDigest,canonicalImagePath,imageApprovedAvatar,verifyCanonicalImage} from './character-production-canonical-image.ts'
import type {CanonicalImageBinding,PrivateMediaSource} from './character-production-canonical-image.ts'
import {renderedAudioPath} from './character-production-rendered-audio.ts'
import {heyGenBindingRevision,validateHeyGenProductionConfig} from './character-production-provider-heygen.ts'
import type {HeyGenConfig,ApprovedAvatar} from './character-production-provider-heygen.ts'
/** Dedicated exact image composition; no look-name/inventory substitution. */
export function createCanonicalImageRuntimeProvider(config:HeyGenConfig,expectedUsername:string,key:()=>string|undefined,proofs:readonly CanonicalImageBinding[],images:PrivateMediaSource,audio:PrivateMediaSource,fetcher:typeof fetch=fetch){
 validateHeyGenProductionConfig(config)
 if(config.model!=='avatar_iv'||!expectedUsername||expectedUsername.length>240)throw Error('Image account/model not approved')
 const c={...config,bindings:config.bindings.map(b=>Object.freeze({...b}))},selected:CanonicalImageBinding[]=[],pairs=new Set<string>()
 for(const b of c.bindings){
  const matches=proofs.filter(p=>canonicalImageDigest(p)===b.imageBindingSha256&&heyGenBindingRevision(c,imageApprovedAvatar(p))===heyGenBindingRevision(c,b))
  if(matches.length!==1||pairs.has(b.avatarId+':'+b.voiceId))throw Error('Ambiguous canonical image binding')
  pairs.add(b.avatarId+':'+b.voiceId);selected.push(Object.freeze({...matches[0],audio:Object.freeze({...matches[0].audio})}))
 }
 const api=createDirectHeyGenApi(key,fetcher,Math.min(config.timeoutMs,8000))
 return {transport:api.imageTransport(c.linkId,selected,images,audio),codecs:directHeyGenCodecs,
 async verifyBinding(b:ApprovedAvatar){
  const ctrl=new AbortController()
  try{
   const proof=selected.find(p=>heyGenBindingRevision(c,imageApprovedAvatar(p))===heyGenBindingRevision(c,b));if(!proof)return false
   const raw=await api.account(ctrl.signal) as {data?:{username?:unknown};error?:unknown}
   if(raw.error||raw.data?.username!==expectedUsername)return false
   const imageBytes=await images.read(canonicalImagePath(proof),proof.imageBytes,ctrl.signal)
   const audioBytes=await audio.read(renderedAudioPath(proof.audio),proof.audio.audioBytes,ctrl.signal)
   return verifyCanonicalImage(proof,imageBytes)&&audioBytes.length===proof.audio.audioBytes&&createHash('sha256').update(audioBytes).digest('hex')===proof.audio.audioSha256

  }catch{return false}finally{ctrl.abort()}
 }}
}
