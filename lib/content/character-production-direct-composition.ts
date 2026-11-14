import {createDirectHeyGenApi,directHeyGenCodecs} from './character-production-heygen-direct.ts'
import {createDirectHeyGenBindingVerifier} from './character-production-direct-inventory.ts'
import {renderedAudioDigest} from './character-production-rendered-audio.ts'
import type {RenderedAudioBinding} from './character-production-rendered-audio.ts'
import type {HeyGenConfig,HeyGenTransport} from './character-production-provider-heygen.ts'
/** One coupled provider dependency set prevents independently configured audio
 * transport and inventory verifier from approving different manifest digests. */
export function createDirectHeyGenRuntimeProvider(config:HeyGenConfig,expectedUsername:string,key:()=>string|undefined,audio:readonly RenderedAudioBinding[],source:Parameters<ReturnType<typeof createDirectHeyGenApi>['audioTransport']>[2],fetcher:typeof fetch=fetch){
 const api=createDirectHeyGenApi(key,fetcher,Math.min(config.timeoutMs,8000))
 const bindings=config.bindings.map(b=>Object.freeze({...b})),pairs=new Set<string>()
 const selected:RenderedAudioBinding[]=[]
 for(const b of bindings){
  const pair=JSON.stringify([b.avatarId,b.voiceId]);if(pairs.has(pair))throw Error('Ambiguous avatar voice pairing');pairs.add(pair)
  if(b.audioBindingSha256){const found=audio.filter(a=>renderedAudioDigest(a)===b.audioBindingSha256&&a.characterId===b.characterId&&a.avatarId===b.avatarId&&a.voiceId===b.voiceId&&a.canonicalRevision===b.canonicalRevision&&a.portraitSha256===b.portraitSha256);if(found.length!==1)throw Error('Missing exact rendered audio proof');selected.push(Object.freeze({...found[0]}))}
 }
 const audioTransport=api.audioTransport(config.linkId,selected,source),native=api.transport(config.linkId,bindings.filter(b=>!b.audioBindingSha256).map(b=>b.voiceId))
 const transport:HeyGenTransport={
  create_video_from_avatar(args,signal){const b=bindings.find(b=>b.avatarId===args.avatarId&&b.voiceId===args.voiceId);if(!b)throw Error('Unbound direct identity');return (b.audioBindingSha256?audioTransport:native).create_video_from_avatar(args,signal)},
  get_video:native.get_video,
 }
 return {transport,codecs:directHeyGenCodecs,verifyBinding:createDirectHeyGenBindingVerifier(api,config,expectedUsername,selected)}
}
