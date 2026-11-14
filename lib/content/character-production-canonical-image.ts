import {createHash} from 'node:crypto'
import {renderedAudioDigest,renderedAudioPath,verifyRenderedAudio} from './character-production-rendered-audio.ts'
import type {RenderedAudioBinding} from './character-production-rendered-audio.ts'
import type {HeyGenTransport,ApprovedAvatar} from './character-production-provider-heygen.ts'
export type CanonicalImageBinding=Readonly<{characterId:string;canonicalRevision:string;portraitSha256:string;imageBytes:number;mime:'image/png'|'image/jpeg';audio:RenderedAudioBinding}>
export type PrivateMediaSource={origin:string;read(path:string,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>;sign(path:string,signal:AbortSignal):Promise<string>}
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex')
export function canonicalImageDigest(b:CanonicalImageBinding){
 const a=b.audio;renderedAudioDigest(a)
 if(b.characterId!==a.characterId||b.canonicalRevision!==a.canonicalRevision||b.portraitSha256!==a.portraitSha256||!Number.isSafeInteger(b.imageBytes)||b.imageBytes<12||b.imageBytes>10*1024*1024||!['image/png','image/jpeg'].includes(b.mime))throw Error('Canonical image proof rejected')
 return sha(JSON.stringify(['canonical-image-v1',b.characterId,b.canonicalRevision,b.portraitSha256,b.imageBytes,b.mime,renderedAudioDigest(a)]))
}
export function canonicalImagePath(b:CanonicalImageBinding){canonicalImageDigest(b);return 'production-inputs/'+b.portraitSha256+(b.mime==='image/png'?'.png':'.jpg')}
export function verifyCanonicalImage(b:CanonicalImageBinding,bytes:Uint8Array){
 canonicalImageDigest(b)
 return bytes.length===b.imageBytes&&sha(bytes)===b.portraitSha256&&(b.mime==='image/png'?Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255)
}
function capability(origin:string,bucket:string,path:string,value:string){
 const u=new URL(value),o=new URL(origin)
 if(o.origin!==origin||o.protocol!=='https:'||!o.hostname.endsWith('.supabase.co')||o.port||u.origin!==origin||u.pathname!=='/storage/v1/object/sign/'+bucket+'/'+path||u.username||u.password||u.hash||!u.searchParams.get('token')||u.search.length>16384||[...u.searchParams.keys()].some(k=>k!=='token'))throw Error('Private media capability rejected')
 return u.href
}
/** Internal adapter only. Call must be the fixed-host direct API, never user input.
 * Wire schema is CreateVideoFromImage: nested image union, no engine field.
 * Image mode uses documented default Avatar IV and cannot substitute native IDs. */
export function canonicalImageTransport(call:(path:string,signal:AbortSignal,body?:unknown)=>Promise<unknown>,account:string,proofs:readonly CanonicalImageBinding[],images:PrivateMediaSource,audio:PrivateMediaSource):HeyGenTransport{
 const frozen=proofs.map(p=>Object.freeze({...p,audio:Object.freeze({...p.audio})}));frozen.forEach(canonicalImageDigest)
 return {
 async create_video_from_avatar(args,signal){
  if(signal.aborted||args.link_id!==account||args.engine.type!=='avatar_iv'||!['9:16','16:9'].includes(args.aspectRatio)||args.outputFormat!=='mp4'||args.resolution!=='1080p')throw Error('Image production scope rejected')
  const matches=frozen.filter(b=>b.audio.avatarId===args.avatarId&&b.audio.voiceId===args.voiceId&&b.audio.scriptSha256===sha(args.script))
  if(matches.length!==1)throw Error('Ambiguous image proof')
  const b=matches[0],ip=canonicalImagePath(b),ap=renderedAudioPath(b.audio)
  if(!verifyCanonicalImage(b,await images.read(ip,b.imageBytes,signal))||!verifyRenderedAudio(b.audio,args.script,args.voiceId,await audio.read(ap,b.audio.audioBytes,signal)))throw Error('Canonical media mismatch')
  const image=capability(images.origin,'cafe-sativa-characters',ip,await images.sign(ip,signal)),sound=capability(audio.origin,'character-production-audio',ap,await audio.sign(ap,signal))
  if(signal.aborted)throw Error('Expired image request')
  return call('/v3/videos',signal,{type:'image',image:{type:'url',url:image},audio_url:sound,aspect_ratio:args.aspectRatio,output_format:'mp4',resolution:'1080p'})
 },get_video(args,signal){if(args.link_id!==account||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(args.videoId))throw Error('Video scope rejected');return call('/v3/videos/'+encodeURIComponent(args.videoId),signal)},
 }
}
export function imageApprovedAvatar(b:CanonicalImageBinding):ApprovedAvatar{return {characterId:b.characterId,canonicalRevision:b.canonicalRevision,portraitSha256:b.portraitSha256,voiceId:b.audio.voiceId,avatarId:b.audio.avatarId,audioBindingSha256:renderedAudioDigest(b.audio),imageBindingSha256:canonicalImageDigest(b)}}
