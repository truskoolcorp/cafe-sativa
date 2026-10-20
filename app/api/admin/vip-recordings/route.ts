import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 const {data,error}=await createAdminClient().from('cs_vip_recordings')
  .select('id,title,description,status,release_at,approved_at,created_at')
  .order('created_at',{ascending:false}).limit(100)
 if(error)return NextResponse.json({error:'Unable to load recording inventory'},{status:503,headers:{'Cache-Control':'private, no-store'}})
 return NextResponse.json({recordings:data||[]},{headers:{'Cache-Control':'private, no-store'}})
}