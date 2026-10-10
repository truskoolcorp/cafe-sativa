import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { approvedAsset } from '@/lib/content/policy'
import { REFERENCE_CANDIDATES } from '@/lib/content/reference-candidates'
import { GLYPH_CHARACTER_SNAPSHOT } from '@/lib/content/glyph-characters'
export const dynamic='force-dynamic'
export const maxDuration=60
const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET() {
  if(!await isContentAdmin())return respond({error:'Unauthorized'},401)
  const {data,error}=await createAdminClient().from('cs_canonical_assets').select('*').eq('active',true)
  if(error)return respond({error:'Reference registry unavailable'},503)
  return respond({candidates:REFERENCE_CANDIDATES.map(candidate=>({...candidate,approved:(data || []).find(asset=>asset.kind===candidate.kind && asset.subject===candidate.subject && approvedAsset(asset)) || null})),missingCandidateRooms:[],glyphCharacters:GLYPH_CHARACTER_SNAPSHOT})
}
export async function POST(req:NextRequest) {
  if(!await isContentAdmin())return respond({error:'Unauthorized'},401)
  if(req.headers.get('origin')!==req.nextUrl.origin)return respond({error:'Invalid origin'},403)
  try {
    const body=await req.json()
    const candidate=REFERENCE_CANDIDATES.find(item=>item.key===body.key)
    if(!candidate || candidate.sha256!==body.expectedSha || body.confirmIdentity!==true || body.confirmLayout!==true)return respond({error:'Review the image and confirm both reference checks'},400)
    if(candidate.kind==='venue' && body.confirmEmptyRoom!==true)return respond({error:'Venue generation requires an empty-room reference with no people'},400)
    const {data:{user}}=await createClient().auth.getUser()
    if(!user || user.app_metadata?.cafe_sativa_admin!==true)return respond({error:'Unauthorized'},401)
    const db=createAdminClient()
    const existing=await db.from('cs_canonical_assets').select('id').eq('kind',candidate.kind).eq('subject',candidate.subject).eq('active',true).maybeSingle()
    if(existing.error)throw existing.error
    if(existing.data)return respond({error:'An active reference already exists. It has been preserved; replacement needs a new version review.'},409)
    // Fixed paths only: callers cannot make the server fetch arbitrary URLs.
    const source=await fetch(`https://www.cafe-sativa.com${candidate.path}`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)})
    const extension=candidate.path.split('.').pop()!
    const mime=extension==='webp'?'image/webp':extension==='jpg'?'image/jpeg':'image/png'
    if(!source.ok || source.headers.get('content-type')?.split(';')[0]!==mime || !source.body)return respond({error:'Candidate image unavailable'},409)
    const reader=source.body.getReader(),parts:Uint8Array[]=[];let size=0
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10000000){await reader.cancel();return respond({error:'Reference exceeds 10 MB'},413)}parts.push(part.value)}
    const bytes=Buffer.concat(parts)
    if(createHash('sha256').update(bytes).digest('hex')!==candidate.sha256)return respond({error:'Candidate changed since this version. Refresh and review the current image.'},409)
    const path=`reviewed/${candidate.kind}/${candidate.subject}-${candidate.sha256}.${extension}`
    const bucket=db.storage.from('cafe-sativa-canon')
    const uploaded=await bucket.upload(path,bytes,{contentType:mime,upsert:false})
    if(uploaded.error){const stored=await bucket.download(path);if(stored.error || !stored.data || createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex')!==candidate.sha256)throw uploaded.error}
    const url=bucket.getPublicUrl(path).data.publicUrl
    const inserted=await db.from('cs_canonical_assets').insert({kind:candidate.kind,subject:candidate.subject,url,sha256:candidate.sha256,version:`owner-review-${candidate.sha256.slice(0,16)}`,approved_by:user.id,approved_at:new Date().toISOString(),active:true}).select('id').single()
    if(inserted.error)return respond({error:'Reference could not be registered, or another approval won the race. Refresh before retrying.'},409)
    return respond({approved:true,id:inserted.data.id})
  }catch{return respond({error:'Reference approval failed; refresh its status before retrying.'},503)}
}
