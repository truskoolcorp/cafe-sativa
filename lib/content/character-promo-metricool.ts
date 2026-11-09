import { createHash } from 'node:crypto'
import { promoSnapshotDigest, PromoSnapshot, PromoReceipt } from './character-promo-delivery'
import { providerLocalDate } from './social-contract'

// Dormant adapter. No credentials, client construction or runtime callers here.
export type PromoMetricoolSession = { call(name: string, args: unknown): Promise<any> }
export type PromoMediaBucket = {
  download(path: string): Promise<{data: {arrayBuffer(): Promise<ArrayBuffer>} | null; error: unknown}>
  createSignedUrl(path: string, seconds: number): Promise<{data: {signedUrl: string} | null; error: unknown}>
}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
export function verifyPromoMetricoolBrand(data: any, s: PromoSnapshot) {
  const rows=Array.isArray(data)?data:data?.data
  if(!Array.isArray(rows))throw new Error('Missing provider brand mapping')
  // Duplicate brand IDs, even with a different user, are ambiguous.
  const candidates=rows.filter(r=>String(r.id)===s.brandId)
  const b=candidates[0]
  if(candidates.length!==1 || String(b.userId)!==s.userId || b.networksData?.facebookData!=='146219355471397' || b.networksData?.threadsData!=='truskoolcorp' || b.timezone!==s.timezone)throw new Error('Provider destination mapping changed')
}
function matches(post: any, s: PromoSnapshot) {
  return post.text===s.caption && post.publicationDate?.dateTime===providerLocalDate(s.scheduledAt,s.timezone) && post.publicationDate?.timezone===s.timezone && Array.isArray(post.providers) && post.providers.length===1 && post.providers[0].network===s.network
}
/** Must only be supplied as executor.submit after a durable atomic claim.
 * Sign the exact content-addressed master; never crop/encode an unapproved derivative.
 * The byte-reader must bound downloads, reject redirects and restrict CDN URLs.
 */
export function characterPromoMetricoolSubmit(deps: {
  openSession(): Promise<PromoMetricoolSession>; bucket: PromoMediaBucket
  storageOrigin: string
  readProviderMedia(url: string): Promise<Uint8Array>
  now(): number
}) {
  return async (s: PromoSnapshot, bytes: Uint8Array, revalidate: () => Promise<void>): Promise<PromoReceipt> => {
    if(hash(bytes)!==s.videoSha256)throw new Error('Approved input bytes changed')
    if(s.brandId!=='5373515'||s.userId!=='4174093'||s.characterId!=='keith'|| !['facebook','threads'].includes(s.network) || s.accountId!==(s.network==='facebook'?'146219355471397':'truskoolcorp'))throw new Error('Unsupported approved destination')
    // The existing MCP session has a 25-second absolute deadline. Read media first.
    const stored=await deps.bucket.download(s.videoPath)
    if(stored.error||!stored.data||hash(new Uint8Array(await stored.data.arrayBuffer()))!==s.videoSha256)throw new Error('Stored approved media changed')
    await revalidate()
    const session=await deps.openSession()
    await verifyPromoMetricoolBrand(await session.call('getBrandSettings',{}),s)
    const window={brandId:s.brandId,fromDate:new Date(Date.parse(s.scheduledAt)-86400000).toISOString(),toDate:new Date(Date.parse(s.scheduledAt)+86400000).toISOString(),timezone:s.timezone,extendedRange:false}
    const before=await session.call('getScheduledPosts',window)
    const prior=Array.isArray(before)?before:before?.data
    if(!Array.isArray(prior)||prior.some(p=>matches(p,s)))throw new Error('Duplicate or ambiguous provider schedule')
    const signed=await deps.bucket.createSignedUrl(s.videoPath,3600)
    if(signed.error||!signed.data)throw new Error('Exact media URL unavailable')
    const url=new URL(signed.data.signedUrl),origin=new URL(deps.storageOrigin)
    if(url.protocol!=='https:'||url.origin!==origin.origin||url.username||url.password||decodeURIComponent(url.pathname)!==`/storage/v1/object/sign/cafe-sativa-content/${s.videoPath}`)throw new Error('Unscoped media URL')
    if(Date.parse(s.scheduledAt)<=deps.now()+60_000)throw new Error('Schedule expired before provider submission')
    const date=providerLocalDate(s.scheduledAt,s.timezone)
    // No automatic retries, including authentication retries, around this call.
    const created=await session.call('createScheduledPost',{blogId:s.brandId,date,mediaFiles:[url.toString()],info:JSON.stringify({text:s.caption,providers:[{network:s.network}],publicationDate:{dateTime:date,timezone:s.timezone},autoPublish:true,draft:false,...(s.network==='facebook'?{facebookData:{type:'POST'}}:{threadsData:{type:'POST',replyControl:'EVERYONE',shareAsInstagramStory:false}})})})
    const identity=created?.data && !Array.isArray(created.data)?created.data:created
    if(!identity?.id||!identity?.uuid)throw new Error('Create response lacks scheduling identity')
    const after=await session.call('getScheduledPosts',window)
    const rows=Array.isArray(after)?after:after?.data
    if(!Array.isArray(rows))throw new Error('Scheduling readback unavailable')
    const found=rows.filter(p=>matches(p,s) && String(p.id)===String(identity.id) && String(p.uuid)===String(identity.uuid))
    const post=found[0]
    if(found.length!==1||!post.id||!post.uuid||post.autoPublish!==true||post.draft!==false||!Array.isArray(post.media)||post.media.length!==1)throw new Error('Ambiguous scheduling readback')
    const media=new URL(post.media[0])
    if(media.protocol!=='https:'||media.hostname!=='static.metricool.com'||media.username||media.password)throw new Error('Unverified provider media')
    // Re-hosting must preserve bytes. Transcoding requires separately approved export/lineage.
    if(hash(await deps.readProviderMedia(media.toString()))!==s.videoSha256)throw new Error('Provider media bytes unverified')
    await verifyPromoMetricoolBrand(await session.call('getBrandSettings',{}),s)
    return {providerId:String(post.id),providerUuid:String(post.uuid),snapshotDigest:promoSnapshotDigest(s),videoSha256:s.videoSha256,network:s.network,accountId:s.accountId,brandId:s.brandId,userId:s.userId,caption:s.caption,scheduledAt:s.scheduledAt,timezone:s.timezone,state:'scheduled'}
  }
}

/** Bounded CDN reader for the dormant adapter; never follows redirects or sends credentials. */
export async function readCharacterPromoProviderMedia(value: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const url=new URL(value)
  if(url.protocol!=='https:'||url.hostname!=='static.metricool.com'||url.port||url.username||url.password)throw new Error('Unapproved media host')
  const response=await fetcher(url.toString(),{redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15_000)})
  if(!response.ok||!response.body)throw new Error('Provider media unavailable')
  const max=35*1024*1024
  const declared=response.headers.get('content-length')
  if(declared && (!/^\d+$/.test(declared)||Number(declared)>max)) { await response.body.cancel(); throw new Error('Provider media size unsupported') }
  const reader=response.body.getReader(),chunks:Uint8Array[]=[]
  let total=0
  try {
    for(;;) {
      const chunk=await reader.read()
      if(chunk.done)break
      total+=chunk.value.byteLength
      if(total>max)throw new Error('Provider media size unsupported')
      chunks.push(chunk.value)
    }
  } catch(error) { await reader.cancel().catch(()=>{}); throw error }
  if(total<16)throw new Error('Empty provider media')
  return Buffer.concat(chunks,total)
}
