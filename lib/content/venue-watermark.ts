import { createHash } from 'node:crypto'
import { KNOWN_THIRD_PARTY_MARKED_SHA256 } from '@/lib/content/character-promo-watermark'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const validPath=(jobId:string,path:string)=>typeof path==='string' && (UUID.test(path.replace(/\.mp4$/,''))&&path.endsWith('.mp4') || new RegExp('^variants/'+jobId+'/[a-f0-9]{64}-(feed|landscape)-preserve-frame-v1/[a-f0-9]{64}\\.mp4$').test(path))
export const VENUE_MEDIA_MAX_BYTES=50*1024*1024
export type VenueWatermarkEvidence={job_id:string;object_path:string;sha256:string;result:string;reviewer_id:string;reviewed_at:string;evidence:string}
export function venueWatermarkPass(job:{id:string;output_url:string},hash:string,rows:VenueWatermarkEvidence[],now=Date.now()) {
 if(!UUID.test(job.id)||!validPath(job.id,job.output_url)||!/^[a-f0-9]{64}$/.test(hash)||KNOWN_THIRD_PARTY_MARKED_SHA256.includes(hash))return false
 if(rows.length!==1)return false
 const r=rows[0],at=Date.parse(r.reviewed_at)
 return r.job_id===job.id&&r.object_path===job.output_url&&r.sha256===hash&&r.result==='pass'&&UUID.test(r.reviewer_id)&&Number.isFinite(at)&&at<=now&&r.evidence.trim().length>0&&r.evidence.length<=1000
}
// Backend-only storage. No provider URL, publication flag or general QA stamp is evidence.
// Return the exact reviewed bytes, so public streaming cannot refetch changed bytes.
let activeReads=0
export async function inspectVenueBytes(db:any,job:{id:string;output_url:string},options:{origin?:string;fetcher?:typeof fetch;timeoutMs?:number}={}) {
 if(!UUID.test(job.id)||!validPath(job.id,job.output_url))throw new Error('Private venue master required')
 if(activeReads>=2)throw new Error('Venue media capacity busy')
 const origin=new URL(options.origin||process.env.NEXT_PUBLIC_SUPABASE_URL||'').origin
 const timeout=options.timeoutMs??20000
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>20000)throw new Error('Invalid deadline')
 const abort=new AbortController();activeReads++
 let timer:ReturnType<typeof setTimeout>
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('Venue media deadline'))},timeout)})
 const work=(async()=>{
  const metadata=await db.storage.getBucket('cafe-sativa-content')
  const cap=Number(metadata.data?.file_size_limit)
  if(abort.signal.aborted||metadata.error||metadata.data?.public!==false||!Number.isSafeInteger(cap)||cap<16||cap>VENUE_MEDIA_MAX_BYTES)throw new Error('Bounded private venue bucket required')
  const signed=await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url,60)
  if(abort.signal.aborted||signed.error||!signed.data?.signedUrl)throw new Error('Private source unavailable')
  const url=new URL(signed.data.signedUrl)
  const expected='/storage/v1/object/sign/cafe-sativa-content/'+job.output_url
  if(url.protocol!=='https:'||url.origin!==origin||decodeURIComponent(url.pathname)!==expected||url.username||url.password)throw new Error('Unexpected private source')
  const response=await (options.fetcher||fetch)(url,{cache:'no-store',redirect:'error',signal:abort.signal})
  if(!response.ok||!response.body)throw new Error('Private source unavailable')
  const length=response.headers.get('content-length')
  if(length&&(!/^\d+$/.test(length)||Number(length)>VENUE_MEDIA_MAX_BYTES)){await response.body.cancel();throw new Error('Venue media size exceeded')}
  const reader=response.body.getReader(),chunks:Buffer[]=[];let total=0,chunkCount=0
  try { while(true){const next=await reader.read();if(abort.signal.aborted)throw new Error('Venue media deadline');if(next.done)break;if(!(next.value instanceof Uint8Array)||++chunkCount>8192||next.value.byteLength===0)throw new Error('Invalid or excessive media chunks');total+=next.value.byteLength;if(total>VENUE_MEDIA_MAX_BYTES)throw new Error('Venue media size exceeded');chunks.push(Buffer.from(next.value))} }
  catch(error){await reader.cancel().catch(()=>{});throw error} finally {reader.releaseLock()}
  const bytes=Buffer.concat(chunks,total)
  if(total<16||length&&Number(length)!==total||bytes.toString('ascii',4,8)!=='ftyp')throw new Error('Invalid venue MP4')
  return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')}
 })().finally(()=>{activeReads--;clearTimeout(timer)})
 // If an SDK/fetch operation ignores cancellation, its admission stays occupied
 // until it really settles. Timeout never releases an orphan operation.
 return Promise.race([work,deadline])
}
export async function reviewedVenueBytes(db:any,job:{id:string;output_url:string},options:Parameters<typeof inspectVenueBytes>[2]={}) {
 const result=await inspectVenueBytes(db,job,options)
 const found=await db.from('cs_venue_media_watermark_reviews').select('job_id,object_path,sha256,result,reviewer_id,reviewed_at,evidence').eq('job_id',job.id).eq('object_path',job.output_url).eq('sha256',result.sha256).limit(2)
 if(found.error||!venueWatermarkPass(job,result.sha256,found.data||[]))throw new Error('Exact-media watermark review required')
 return result
}

export function venueByteRange(bytes:Buffer,range:string|null) {
 if(!range)return {status:200,body:bytes,headers:{'Content-Length':String(bytes.length)}}
 const m=/^bytes=(\d*)-(\d*)$/.exec(range)
 if(!m||(!m[1]&&!m[2]))return null
 const start=m[1]?Number(m[1]):Math.max(0,bytes.length-Number(m[2]))
 const end=m[1]?(m[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1):bytes.length-1
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start||(!m[1]&&Number(m[2])===0))return null
 return {status:206,body:bytes.subarray(start,end+1),headers:{'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${bytes.length}`}}
}

// Stream already-verified bytes, never a second storage fetch. No buffering by response API.
let activeResponses=0
export function acquireVenueResponse(){if(activeResponses>=2)return null;activeResponses++;let released=false;return ()=>{if(!released){released=true;activeResponses--}}}
export function venueByteStream(bytes:Buffer,release:()=>void=()=>{}) {
 let offset=0
 return new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length){controller.close();release();return}const end=Math.min(offset+65536,bytes.length);controller.enqueue(new Uint8Array(bytes.subarray(offset,end)));offset=end},cancel(){release()}})
}
