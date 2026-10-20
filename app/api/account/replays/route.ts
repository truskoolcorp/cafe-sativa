import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const noStore = {'Cache-Control':'private, no-store'}
export async function GET(req:NextRequest) {
  const auth = createClient()
  const {data:{user}} = await auth.auth.getUser()
  if(!user)return NextResponse.json({error:'Sign in required'},{status:401,headers:noStore})
  const {data:member,error:memberError}=await auth.from('members_v').select('tier,status,is_admin').eq('id',user.id).maybeSingle()
  if(memberError)return NextResponse.json({error:'Membership could not be checked'},{status:503,headers:noStore})
  const entitled = (member?.tier==='vip' && member.status==='active') || member?.is_admin===true || user.app_metadata?.cafe_sativa_admin===true
  if(!entitled)return NextResponse.json({entitled:false,items:[]},{headers:noStore})
  const db=createAdminClient()
  const now=new Date().toISOString()
  const {data,error}=await db.from('cs_vip_recordings').select('id,title,description,release_at').eq('status','published').lte('release_at',now).order('release_at',{ascending:false}).limit(50)
  if(error)return NextResponse.json({error:'Replay catalog unavailable'},{status:503,headers:noStore})
  const id=req.nextUrl.searchParams.get('play')
  if(id){
    if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid replay'},{status:400,headers:noStore})
    const visible=(data||[]).some(record=>record.id===id)
    if(!visible)return NextResponse.json({error:'Replay unavailable'},{status:404,headers:noStore})
    const result=await db.from('cs_vip_recordings').select('storage_bucket,storage_path').eq('id',id).eq('status','published').lte('release_at',now).maybeSingle()
    if(result.error || !result.data)return NextResponse.json({error:'Replay unavailable'},{status:404,headers:noStore})
    const signed=await db.storage.from(result.data.storage_bucket).createSignedUrl(result.data.storage_path,120)
    if(signed.error || !signed.data)return NextResponse.json({error:'Replay temporarily unavailable'},{status:503,headers:noStore})
    return NextResponse.json({url:signed.data.signedUrl,expiresInSeconds:120},{headers:noStore})
  }
  return NextResponse.json({entitled:true,items:data||[]},{headers:noStore})
}
