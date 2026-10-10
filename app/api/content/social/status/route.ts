import { NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET() {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    const {data,error}=await createAdminClient().from('cs_social_connections').select('status,brand_label,verified_at,dispatch_enabled').eq('provider','metricool').maybeSingle()
    if(error)throw error
    return NextResponse.json({connected:data?.status==='verified',brand:data?.brand_label || null,verifiedAt:data?.verified_at || null,automaticDispatchEnabled:false,allowedNetworks:['facebook','threads'],configured:Boolean(process.env.CS_SOCIAL_ENCRYPTION_KEY && process.env.CS_METRICOOL_OAUTH_CLIENT_ID)},{headers:{'Cache-Control':'private, no-store'}})
  }catch{return NextResponse.json({error:'Social connection status unavailable'},{status:503})}
}
