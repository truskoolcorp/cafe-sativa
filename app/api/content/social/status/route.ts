import { NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET() {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    const db=createAdminClient()
    const {data,error}=await db.from('cs_social_connections').select('status,brand_label,verified_at,dispatch_enabled,capabilities_verified,last_check_at,last_error').eq('provider','metricool').maybeSingle()
    if(error)throw error
    const receipts=await db.from('cs_social_deliveries').select('id,content_item_id,state,scheduled_at,provider_post_id,provider_uuid,receipt,error,checked_at').order('scheduled_at').limit(30)
    if(receipts.error)throw receipts.error
    return NextResponse.json({connected:data?.status==='verified',brand:data?.brand_label || null,verifiedAt:data?.verified_at || null,automaticDispatchEnabled:Boolean(data?.dispatch_enabled && data.capabilities_verified),deliveryConfigured:Boolean(data?.dispatch_enabled),lastCheckAt:data?.last_check_at,lastError:data?.last_error,receipts:receipts.data,allowedNetworks:['facebook','threads'],configured:Boolean(process.env.CS_SOCIAL_ENCRYPTION_KEY && process.env.CS_METRICOOL_OAUTH_CLIENT_ID)},{headers:{'Cache-Control':'private, no-store'}})
  }catch{return NextResponse.json({error:'Social connection status unavailable'},{status:503})}
}
