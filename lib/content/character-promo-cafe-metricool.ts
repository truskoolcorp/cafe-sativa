import { createHash } from 'node:crypto'
import { providerLocalDate } from './social-contract'
import { assertNoKnownExternalPromo } from './character-promo-known-external'
import { promoDispatchTimeIssue } from './character-promo-dispatch-time'

/** Dormant injected adapter. No route, credentials, activation, or provider client. */
export const CAFE_METRICOOL_DISPATCH_ENABLED = false
const accounts = { facebook: '105363501666032', instagram: 'cafesativainc' } as const
export type CafeNetwork = keyof typeof accounts
export type CafeCollaborator = { network: 'instagram'; handle: string; characterId: string; evidenceRef: string }
export type CafeSchedule = {
 version: 1; planId: string; promoId: string; characterId: string; brandId: '7605217'; userId: string
 network: CafeNetwork; accountId: string; timezone: string; scheduledAt: string
 videoSha256: string; videoPath: string; contentApprovalDigest: string
 caption: string; hashtags: string[]; facebookTitle?: string; collaborators: CafeCollaborator[]
}
export type CafeReceipt = {
 providerId: string; providerUuid: string; digest: string; brandId: string; network: CafeNetwork
 accountId: string; scheduledAt: string; state: 'scheduled'; publicationConfirmed: false
 collaborators: {handle: string; state: 'invitation_requested'; acceptanceConfirmed: false}[]
}
export type CafeIdentity = {providerId: string; providerUuid: string}
export type CafeDispatchDeps = {
 now(): number
 storageOrigin: string
 /** Must read fresh canonical/content QA including watermark, exact final bytes,
  * publication authority, connection identity and per-persona collaborators.
  * The adapter never manufactures or broadens this approval. */
 authorize(snapshot: CafeSchedule, digest: string): Promise<void>
 store: {
  /** One transaction: UNIQUE(planId), UNIQUE(destinationTimeKey), UNIQUE(mediaDestinationKey),
   * exact digest/approval compare. No partial reservation; never expire/reclaim. */
  claim(input: {planId: string; digest: string; destinationTimeKey: string; mediaDestinationKey: string}): Promise<string | null>
  /** Persist immediately after create, before further network calls. CAS claim token. */
  recordIdentity(planId: string, token: string, identity: CafeIdentity): Promise<boolean>
  finish(planId: string, token: string, state: 'scheduled' | 'submission_unknown', receipt: CafeReceipt | null): Promise<boolean>
 }
 /** Must verify exact private bytes, bounded media and signed URL scope. */
 media(snapshot: CafeSchedule): Promise<{url: string; sha256: string}>
 verifyHostedMedia(url: string, sha256: string): Promise<void>
 /** Existing bearer session with bounded deadline, cancellation, no retry middleware. */
 openSession(): Promise<{call(name: 'getBrandSettings'|'getScheduledPosts'|'createScheduledPost', args: object): Promise<any>}>
 verifiedCollaborators: readonly CafeCollaborator[]
}
const stable=(v: any): string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)
export const cafeScheduleDigest=(s: CafeSchedule)=>createHash('sha256').update(stable(s)).digest('hex')
export function cafeReservationKeys(s:CafeSchedule) {
 const hash=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex')
 const destination=[s.brandId,s.network,s.accountId]
 return {destinationTimeKey:hash([...destination,s.scheduledAt]),mediaDestinationKey:hash([...destination,s.videoSha256])}
}
const sha=(v:string)=>/^[a-f0-9]{64}$/.test(v)
const identity=(v: unknown)=>typeof v==='string'&&v.length>0&&v.length<=256?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null
const rows=(v:any)=>Array.isArray(v)?v:Array.isArray(v?.data)?v.data:null
const text=(s:CafeSchedule)=>s.caption+(s.hashtags.length?'\n\n'+s.hashtags.map(h=>'#'+h).join(' '):'')
function assert(ok: unknown, message:string): asserts ok {if(!ok)throw Error(message)}
export function validateCafeSchedule(s:CafeSchedule, verified:readonly CafeCollaborator[], now:number) {
 assert(s.version===1&&s.planId&&s.promoId&&s.characterId&&s.brandId==='7605217'&&s.userId==='4174093'&&s.timezone==='America/Chicago','Exact Café identity required')
 assert(Object.hasOwn(accounts,s.network)&&s.accountId===accounts[s.network],'Unverified Café destination')
 assert(sha(s.videoSha256)&&sha(s.contentApprovalDigest)&&s.videoPath&&!s.videoPath.includes('..'),'Exact approved content required')
 assert(Number.isFinite(now)&&Date.parse(s.scheduledAt)>now+60000&&new Date(s.scheduledAt).toISOString()===s.scheduledAt&&!promoDispatchTimeIssue(s.scheduledAt,s.timezone),'Exact future schedule required')
 assert(typeof s.caption==='string'&&s.caption.trim()&&Array.isArray(s.hashtags)&&s.hashtags.length<=5&&new Set(s.hashtags).size===s.hashtags.length&&s.hashtags.every(h=>/^[\p{L}\p{N}_]{1,80}$/u.test(h)),'Reviewed caption and relevant distinct hashtags required')
 // Count the exact final payload, including editorial inline tags. Do not
 // rewrite reviewed caption text to conceal duplicates or over-limit content.
 const finalText=text(s),tags=Array.from(finalText.matchAll(/#([\p{L}\p{N}_]+)/gu),m=>m[1])
 const folded=tags.map(tag=>tag.normalize('NFKC').toUpperCase().toLowerCase())
 assert(tags.length<=5&&new Set(folded).size===folded.length,'Final caption must contain at most five distinct hashtags')
 assert(Array.from(finalText).length<=2200,'Caption exceeds adapter limit')
 assert(Array.isArray(s.collaborators)&&s.collaborators.length<=3&&new Set(s.collaborators.map(c=>c.handle)).size===s.collaborators.length,'Ambiguous collaborators')
 if(s.network==='facebook')assert(typeof s.facebookTitle==='string'&&s.facebookTitle.trim()&&Array.from(s.facebookTitle).length<=100&&s.collaborators.length===0,'Facebook title required; Instagram collaborators are not Facebook tags')
 else assert(s.facebookTitle===undefined,'Facebook metadata cannot leak to Instagram')
 for(const c of s.collaborators)assert(c.network==='instagram'&&c.characterId===s.characterId&&c.evidenceRef&&/^[a-zA-Z0-9_.]{1,30}$/.test(c.handle)&&c.handle!=='cafesativainc'&&verified.filter(v=>stable(v)===stable(c)).length===1,'Collaborator not verified for this persona and network')
}
/** Caption @text is plain editorial text, never a verified Facebook identity tag.
 * Only the structured Instagram collaborators field requests invitations. */
export function cafeMetricoolInfo(s:CafeSchedule) {
 return {text:text(s),providers:[{network:s.network}],publicationDate:{dateTime:providerLocalDate(s.scheduledAt,s.timezone),timezone:s.timezone},autoPublish:true,draft:false,
 ...(s.network==='facebook'?{facebookData:{type:'REEL',title:s.facebookTitle}}:{instagramData:{type:'REEL',autoPublish:true,showReelOnFeed:true,isAiGenerated:true,collaborators:s.collaborators.map(c=>({username:c.handle,deleted:false}))}})}
}
function verifyBrand(data:any,s:CafeSchedule) {
 const found=rows(data)?.filter((b:any)=>String(b.id)===s.brandId)
 assert(found?.length===1,'Missing or ambiguous Café brand')
 const b=found[0]
 assert(String(b.userId)===s.userId&&b.timezone===s.timezone&&String(b.networksData?.facebookData)===accounts.facebook&&b.networksData?.instagramData===accounts.instagram,'Café connection changed')
}
function sameSlot(post:any,s:CafeSchedule) {
 return post.publicationDate?.dateTime===providerLocalDate(s.scheduledAt,s.timezone)&&post.publicationDate?.timezone===s.timezone&&post.providers?.some((p:any)=>p.network===s.network)
}
function exactReadback(p:any,s:CafeSchedule) {
 const info=cafeMetricoolInfo(s), platform=s.network==='facebook'?'facebookData':'instagramData'
 const expected='facebookData' in info?info.facebookData:info.instagramData
 return sameSlot(p,s)&&p.text===info.text&&p.providers.length===1&&p.providers[0].status==='PENDING'&&p.autoPublish===true&&p.draft===false&&Object.entries(expected).every(([k,v])=>stable(p[platform]?.[k])===stable(v))
}
/** Disabled by default. Any uncertainty consumes the durable claim, never retries. */
export async function dispatchCafeMetricool(input:CafeSchedule,deps:CafeDispatchDeps,options:{enabled?:boolean}={}) {
 if(options.enabled!==true)return {status:'disabled' as const,publicationConfirmed:false}
 // Own all nested inputs before awaits; immutable digest is the permission boundary.
 const s=JSON.parse(JSON.stringify(input)) as CafeSchedule
 validateCafeSchedule(s,deps.verifiedCollaborators,deps.now())
 const digest=cafeScheduleDigest(s)
 const revalidate=async()=>{assert(cafeScheduleDigest(s)===digest,'Pinned schedule mutated');validateCafeSchedule(s,deps.verifiedCollaborators,deps.now());assertNoKnownExternalPromo(s);await deps.authorize(JSON.parse(JSON.stringify(s)),digest);validateCafeSchedule(s,deps.verifiedCollaborators,deps.now());assertNoKnownExternalPromo(s)}
 await revalidate()
 const token=await deps.store.claim({planId:s.planId,digest,...cafeReservationKeys(s)})
 if(!token)return {status:'already_claimed_or_stale' as const,publicationConfirmed:false}
 try {
  await revalidate()
  const media=await deps.media(JSON.parse(JSON.stringify(s)))
  assert(media.sha256===s.videoSha256,'Media hash changed')
  const url=new URL(media.url), origin=new URL(deps.storageOrigin)
  assert(origin.protocol==='https:'&&origin.pathname==='/'&&!origin.username&&!origin.password&&url.protocol==='https:'&&url.origin===origin.origin&&!url.username&&!url.password&&decodeURIComponent(url.pathname)===`/storage/v1/object/sign/cafe-sativa-content/${s.videoPath}`,'Unscoped private media handoff')
  const session=await deps.openSession()
  verifyBrand(await session.call('getBrandSettings',{}),s)
  const window={brandId:s.brandId,fromDate:new Date(Date.parse(s.scheduledAt)-86400000).toISOString(),toDate:new Date(Date.parse(s.scheduledAt)+86400000).toISOString(),timezone:s.timezone,extendedRange:false}
  const before=rows(await session.call('getScheduledPosts',window))
  // Conservative collision check ignores changed caption, so rewording cannot
  // accidentally evade an existing destination/time reservation.
  assert(before&&before.every((p:any)=>p&&typeof p.publicationDate?.dateTime==='string'&&typeof p.publicationDate?.timezone==='string'&&Array.isArray(p.providers)&&p.providers.length>0&&p.providers.every((n:any)=>typeof n?.network==='string'))&&!before.some((p:any)=>sameSlot(p,s)),'Existing or ambiguous provider slot')
  await revalidate()
  const response=await session.call('createScheduledPost',{blogId:s.brandId,date:providerLocalDate(s.scheduledAt,s.timezone),mediaFiles:[media.url],info:JSON.stringify(cafeMetricoolInfo(s))})
  const created=response?.data&&!Array.isArray(response.data)?response.data:response
  const providerId=identity(created?.id),providerUuid=identity(created?.uuid)
  assert(providerId&&providerUuid,'Lossless scheduling identity unavailable')
  assert(await deps.store.recordIdentity(s.planId,token,{providerId,providerUuid}),'Scheduling identity was not persisted')
  const after=rows(await session.call('getScheduledPosts',window))
  const found=after?.filter((p:any)=>identity(p.id)===providerId&&identity(p.uuid)===providerUuid)
  assert(found?.length===1&&exactReadback(found[0],s),'Exact metadata scheduling readback unavailable')
  const post=found[0]
  assert(Array.isArray(post.media)&&post.media.length===1,'Ambiguous hosted media')
  const hosted=new URL(post.media[0])
  assert(hosted.protocol==='https:'&&hosted.hostname==='static.metricool.com'&&!hosted.port&&!hosted.username&&!hosted.password,'Unverified hosted media origin')
  await deps.verifyHostedMedia(hosted.toString(),s.videoSha256)
  verifyBrand(await session.call('getBrandSettings',{}),s)
  await revalidate()
  const receipt:CafeReceipt={providerId,providerUuid,digest,brandId:s.brandId,network:s.network,accountId:s.accountId,scheduledAt:s.scheduledAt,state:'scheduled',publicationConfirmed:false,collaborators:s.collaborators.map(c=>({handle:c.handle,state:'invitation_requested',acceptanceConfirmed:false}))}
  assert(await deps.store.finish(s.planId,token,'scheduled',receipt),'Receipt persistence unverified')
  return {status:'scheduled' as const,publicationConfirmed:false,receipt}
 }catch{
  try{await deps.store.finish(s.planId,token,'submission_unknown',null)}catch{/* non-reclaimable claim and any recorded identity survive */}
  return {status:'submission_unknown' as const,publicationConfirmed:false}
 }
}

