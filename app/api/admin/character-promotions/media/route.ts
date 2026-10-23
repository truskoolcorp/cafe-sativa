import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime='nodejs'
export const dynamic='force-dynamic'
const allowed: Record<string,string> = {
  '3f85873d-7c7b-48c4-8225-fdf9542d486a':'andromeda-zouganelis',
  '4c146dda-4e1c-400f-8371-b49c4dc2eed0':'aurelio',
}
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(req:NextRequest) {
  if(!(await isContentAdmin()))return json({error:'Unauthorized'},401)
  if(req.headers.get('origin')!==req.nextUrl.origin)return json({error:'Invalid origin'},403)
  try {
    const body=await req.json()
    const {promoId,sha256,size,stage}=body
    if(typeof promoId!=='string'||!allowed[promoId]||typeof sha256!=='string'||!/^[0-9a-f]{64}$/.test(sha256)||!Number.isInteger(size)||size<1024||size>90*1024*1024||!['init','complete'].includes(stage))return json({error:'Invalid media request'},400)
    const db=createAdminClient()
    const found=await db.from('cs_character_promo_drafts').select('id,character_id,video_asset_path,evidence').eq('id',promoId).single()
    if(found.error||!found.data||found.data.character_id!==allowed[promoId])return json({error:'Character assignment changed'},409)
    const path=`character-promos/${allowed[promoId]}/${promoId}/${sha256}.mp4`
    if(stage==='init') {
      const signed=await db.storage.from('cafe-sativa-content').createSignedUploadUrl(path)
      if(signed.error||!signed.data)return json({error:'Could not authorize storage upload'},503)
      return json({path,token:signed.data.token})
    }
    const downloaded=await db.storage.from('cafe-sativa-content').download(path)
    if(downloaded.error||!downloaded.data)return json({error:'Storage file not found; no record changed'},409)
    const bytes=Buffer.from(await downloaded.data.arrayBuffer())
    if(bytes.length!==size||bytes.toString('ascii',4,8)!=='ftyp'||createHash('sha256').update(bytes).digest('hex')!==sha256)return json({error:'Stored bytes did not pass media integrity validation; original record unchanged'},409)
    const result=await db.from('cs_character_promo_drafts').update({
      video_asset_path:path,voice_approved_at:null,video_qa_approved_at:null,publication_approved_at:null,
      evidence:{...(found.data.evidence||{}),latestMediaReplacement:{previousAssetPath:found.data.video_asset_path,sha256,bytes:size,verifiedAt:new Date().toISOString(),source:'owner admin signed upload'}},
      updated_at:new Date().toISOString()
    }).eq('id',promoId).eq('character_id',allowed[promoId]).select('id,video_asset_path').single()
    if(result.error)return json({error:'MP4 verified but record update failed; reconcile before retry',sha256},503)
    return json({stored:true,sha256,record:result.data,qaRequired:true,publicationScheduled:false})
  }catch{return json({error:'Media reconciliation failed; no publication was attempted'},503)}
}
