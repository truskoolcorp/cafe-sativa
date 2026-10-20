import { NextRequest,NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest){
 const kind=req.nextUrl.searchParams.get('kind')
 if(kind!=='recipe' && kind!=='podcast')return NextResponse.json({error:'Invalid library'},{status:400})
 const {data,error}=await createAdminClient().from('cs_member_library').select('id,kind,title,description,details,external_url,published_at').eq('kind',kind).eq('status','published').lte('published_at',new Date().toISOString()).order('published_at',{ascending:false}).limit(60)
 if(error)return NextResponse.json({error:'Library temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store'}})
 return NextResponse.json({items:data||[]},{headers:{'Cache-Control':'no-store'}})
}