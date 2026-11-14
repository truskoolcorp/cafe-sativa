import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { performance } from 'node:perf_hooks'
import type { ProductionProvider, ProductionSlot, Collection } from './character-production-engine.ts'

/** Verified connector argument subset, not a guessed provider HTTP API. */
export type AvatarModel = 'avatar_v' | 'avatar_iv' | 'avatar_iii' | 'heygen-avatar-6' | 'heygen-avatar-6-turbo'
export type AvatarArguments = Readonly<{
  link_id: string; avatarId: string; voiceId: string; script: string;
  engine: Readonly<{type: AvatarModel}>; aspectRatio: '9:16'|'16:9'; outputFormat: 'mp4'; resolution: '1080p';
}>
export type VideoStatus = {taskId:string;state:'pending'|'failed'} | {taskId:string;state:'completed';mediaUrl:string}
export interface HeyGenTransport {
  /** Must disable write retries. Abort does not establish provider cancellation. */
  create_video_from_avatar(args:AvatarArguments,signal:AbortSignal):Promise<unknown>;
  get_video(args:Readonly<{link_id:string;videoId:string}>,signal:AbortSignal):Promise<unknown>;
}
export interface HeyGenCodecs {
  /** Creation and pending result envelopes are unverified. Trusted deployment
   * codecs must reject errors/unknown shapes; no default receipt decoder exists. */
  receipt(raw:unknown):{taskId:string}; status(raw:unknown):VideoStatus;
}
export type ApprovedAvatar=Readonly<{characterId:string;canonicalRevision:string;portraitSha256:string;voiceId:string;avatarId:string;audioBindingSha256?:string;imageBindingSha256?:string}>
export type HeyGenConfig=Readonly<{
  enabled?:boolean;aspectRatio?:'9:16'|'16:9';linkId:string;model:AvatarModel;bindings:readonly ApprovedAvatar[];
  mediaOrigins:readonly string[];timeoutMs:number;maxVideoBytes:number;
}>
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(v)
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const models=new Set(['avatar_v','avatar_iv','avatar_iii','heygen-avatar-6','heygen-avatar-6-turbo'])
function origin(value:string) {
  const u=new URL(value)
  if(u.protocol!=='https:'||u.username||u.password||u.port||isIP(u.hostname)||u.hostname.includes(':')||u.pathname!=='/'||u.search||u.hash||u.origin!==value) throw Error('Invalid verified media origin')
  return u.origin
}
/** Conservatively supports only public IPv4, including all resolved answers. */
export function isPublicMediaIPv4(address:string) {
  if(isIP(address)!==4)return false
  const [a,b]=address.split('.').map(Number)
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||(a===192&&[0,2,168].includes(b))||(a===198&&[18,19,51].includes(b))||(a===203&&b===0))
}
async function bounded<T>(deadline:number,action:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  const started=Date.now(),remaining=deadline-started,monotonic=performance.now()+remaining
  if(remaining<=0)throw Error('Provider deadline exceeded')
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try {
    const result=await Promise.race([Promise.resolve().then(()=>{
      // A queued microtask may run after expiry if the caller blocked the event loop.
      // Check immediately before dispatch, not only when the response arrives.
      if(controller.signal.aborted||performance.now()>=monotonic||Date.now()>=deadline||Date.now()<started)throw Error('Provider deadline exceeded before dispatch')
      return action(controller.signal)
    }),new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(Error('Provider deadline exceeded; write outcome may be unknown'))},remaining)
    })])
    if(controller.signal.aborted||performance.now()>=monotonic||Date.now()>=deadline||Date.now()<started)throw Error('Provider deadline exceeded')
    return result
  }finally{clearTimeout(timer);controller.abort()}
}
export async function fetchVerifiedMedia(value:string,origins:readonly string[],maxBytes:number,deadline:number):Promise<Uint8Array> {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<12||maxBytes>50_000_000)throw Error('Invalid media cap')
  const allowed=origins.map(origin),u=new URL(value)
  if(u.protocol!=='https:'||u.username||u.password||u.hash||!allowed.includes(u.origin))throw Error('Untrusted media location')
  return bounded(deadline,async signal=>{
    const addresses=await lookup(u.hostname,{all:true,verbatim:true})
    if(signal.aborted)throw Error('Media deadline exceeded')
    if(!addresses.length||addresses.some(a=>!isPublicMediaIPv4(a.address)))throw Error('Nonpublic media address')
    const address=addresses[0].address
    return new Promise<Uint8Array>((resolve,reject)=>{
      const req=request(u,{method:'GET',signal,headers:{Accept:'video/mp4'},lookup:(_host,options,cb)=>{
        if(typeof options==='object'&&'all'in options&&options.all){
          (cb as unknown as (error:null,addresses:{address:string;family:number}[])=>void)(null,[{address,family:4}])
        }else cb(null,address,4)
      }},res=>{
        const fail=(message:string)=>{res.destroy();req.destroy();reject(Error(message))}
        if(res.statusCode!==200)return fail('Media status rejected (redirects prohibited)')
        if((res.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='video/mp4'||
          (res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'))return fail('Invalid media type')
        const length=res.headers['content-length']
        if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes))return fail('Media exceeds cap')
        const chunks:Buffer[]=[];let bytes=0,failed=false
        res.on('data',(chunk:Buffer)=>{if(failed)return;bytes+=chunk.length;if(bytes>maxBytes){failed=true;fail('Media exceeds cap');return}chunks.push(chunk)})
        res.on('error',reject);res.on('aborted',()=>reject(Error('Media stream aborted')))
        res.on('end',()=>{
          if(failed)return
          if(bytes<12||(length&&bytes!==Number(length)))return reject(Error('Invalid media length'))
          const result=Buffer.concat(chunks,bytes)
          if(result.subarray(4,8).toString('ascii')!=='ftyp')return reject(Error('Invalid MP4 header'))
          resolve(result)
        })
      })
      req.on('error',reject);req.end()
    })
  })
}
/** Persist with trusted authorization, immutable claim, and pending job. */
export function heyGenBindingRevision(config:Pick<HeyGenConfig,'linkId'|'model'|'aspectRatio'>,binding:ApprovedAvatar):string {
  if((config.aspectRatio!==undefined&&!['9:16','16:9'].includes(config.aspectRatio))||!id(config.linkId)||!models.has(config.model)||!binding||(binding.audioBindingSha256!==undefined&&!hash(binding.audioBindingSha256))||(binding.imageBindingSha256!==undefined&&(!hash(binding.imageBindingSha256)||!binding.audioBindingSha256||config.model!=='avatar_iv'))||!id(binding.characterId)||!id(binding.avatarId)||!id(binding.voiceId)||!hash(binding.canonicalRevision)||!hash(binding.portraitSha256))throw Error('Invalid provider binding')
  return createHash('sha256').update(JSON.stringify([
    'heygen-avatar-binding-v1','heygen',config.linkId,config.model,binding.characterId,
    binding.canonicalRevision,binding.portraitSha256,binding.voiceId,binding.avatarId,config.aspectRatio??'9:16','mp4','1080p',...(binding.audioBindingSha256?['rendered-audio-v1',binding.audioBindingSha256]:[]),...(binding.imageBindingSha256?['canonical-image-v1',binding.imageBindingSha256]:[]),
  ])).digest('hex')
}
/** Pure preclaim configuration check. Never opens a provider connection. */
export function validateHeyGenProductionConfig(c:HeyGenConfig):void {
  if(!c||c.enabled!==true)throw Error('HeyGen production disabled')
  if(!id(c.linkId)||!models.has(c.model)||!Number.isSafeInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>120000||
    !Number.isSafeInteger(c.maxVideoBytes)||c.maxVideoBytes<12||c.maxVideoBytes>50_000_000||
    !Array.isArray(c.mediaOrigins)||!c.mediaOrigins.length||!Array.isArray(c.bindings)||!c.bindings.length)throw Error('Invalid HeyGen configuration')
  c.mediaOrigins.forEach(origin);const seen=new Set<string>()
  for(const b of c.bindings){heyGenBindingRevision(c,b);if(seen.has(b.characterId))throw Error('Invalid duplicate approved avatar binding');seen.add(b.characterId)}
}
export function createHeyGenProductionProvider(config:HeyGenConfig,transport:HeyGenTransport,codecs:HeyGenCodecs):ProductionProvider {
  const c=Object.freeze({...config,bindings:Object.freeze(config.bindings.map(b=>Object.freeze({...b}))),mediaOrigins:Object.freeze([...config.mediaOrigins])})
  const create=transport.create_video_from_avatar.bind(transport),get=transport.get_video.bind(transport)
  const receipt=codecs.receipt.bind(codecs),status=codecs.status.bind(codecs),lastPoll=new Map<string,number>()
  return Object.freeze({name:'heygen',async submit(input:ProductionSlot){
    validateHeyGenProductionConfig(c);const s=Object.freeze({...input}),b=c.bindings.find(x=>x.characterId===s.characterId)
    if(!b||s.providerBindingRevision!==heyGenBindingRevision(c,b)||s.provider!=='heygen'||s.model!==c.model||b.canonicalRevision!==s.canonicalRevision||b.portraitSha256!==s.portraitSha256||b.voiceId!==s.voiceId||
      !Number.isSafeInteger(s.authorizationExpiresAt)||s.authorizationExpiresAt<=Date.now()||typeof s.script!=='string'||!s.script.trim()||s.script.length>5000)throw Error('Canonical identity or authority mismatch')
    const deadline=Math.min(Date.now()+c.timeoutMs,s.authorizationExpiresAt)
    const args=Object.freeze({link_id:c.linkId,avatarId:b.avatarId,voiceId:b.voiceId,script:s.script,engine:Object.freeze({type:c.model}),aspectRatio:c.aspectRatio??'9:16',outputFormat:'mp4' as const,resolution:'1080p' as const})
    const result=receipt(await bounded(deadline,signal=>create(args,signal)))
    if(Date.now()>=deadline||!result||!id(result.taskId))throw Error('Invalid or late HeyGen receipt')
    return {taskId:result.taskId}
  },async collect(taskId:string,providerBindingRevision:string):Promise<Collection>{
    validateHeyGenProductionConfig(c)
    if(!id(taskId))throw Error('Invalid original task ID')
    if(!hash(providerBindingRevision)||!c.bindings.some(b=>heyGenBindingRevision(c,b)===providerBindingRevision))throw Error('Provider binding revision mismatch')
    const now=Date.now(),monotonic=performance.now(),previous=lastPoll.get(taskId)
    if(previous!==undefined&&monotonic-previous<30000)return {state:'pending'}
    lastPoll.set(taskId,monotonic)
    const deadline=now+c.timeoutMs
    const result=status(await bounded(deadline,signal=>get(Object.freeze({link_id:c.linkId,videoId:taskId}),signal)))
    if(Date.now()>=deadline||!result||result.taskId!==taskId)throw Error('Mismatched or late HeyGen status')
    if(result.state==='pending'||result.state==='failed')return {state:result.state}
    if(result.state!=='completed'||typeof result.mediaUrl!=='string')throw Error('Invalid HeyGen status')
    return {state:'completed',mime:'video/mp4',bytes:await fetchVerifiedMedia(result.mediaUrl,c.mediaOrigins,c.maxVideoBytes,deadline)}
  }})
}
/** Only observed completed get_video shape; not a guessed creation receipt. */
export function decodeVerifiedHeyGenCompleted(raw:unknown):VideoStatus {
  if(!raw||typeof raw!=='object')throw Error('Invalid HeyGen response')
  const r=raw as {isError?:unknown;structuredContent?:unknown}
  if(r.isError!==false||!r.structuredContent||typeof r.structuredContent!=='object')throw Error('Invalid HeyGen response')
  const data=r.structuredContent as Record<string,unknown>
  if(data.outputType!=='video.player'||!id(data.videoId)||data.status!=='completed'||typeof data.videoUrl!=='string')throw Error('Unverified HeyGen response state')
  return {taskId:data.videoId,state:'completed',mediaUrl:data.videoUrl}
}
