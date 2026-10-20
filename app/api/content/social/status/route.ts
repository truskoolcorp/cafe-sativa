import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { processSocialDelivery } from '@/lib/content/social-delivery'
import { unseal } from '@/lib/content/metricool-oauth'
export const maxDuration=60
export const dynamic='force-dynamic'
export async function GET() {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    const db=createAdminClient()
    const {data,error}=await db.from('cs_social_connections').select('status,brand_label,verified_at,dispatch_enabled,capabilities_verified,last_check_at,last_error,credential_ciphertext').eq('provider','metricool').maybeSingle()
    if(error)throw error
    let tokenHealth:{accessExpiresAt:string|null;refreshTokenStored:boolean;tokenLifetimeSeconds:number|null}|null=null
    if(data?.credential_ciphertext){try{const credential=unseal<{obtainedAt?:string;expires_in?:number;refresh_token?:string}>(data.credential_ciphertext,'credentials');const lifetime=Number(credential.expires_in);const issued=Date.parse(credential.obtainedAt||'');tokenHealth={accessExpiresAt:Number.isFinite(issued)&&Number.isFinite(lifetime)?new Date(issued+lifetime*1000).toISOString():null,refreshTokenStored:Boolean(credential.refresh_token),tokenLifetimeSeconds:Number.isFinite(lifetime)?lifetime:null}}catch{tokenHealth=null}}
    const receipts=await db.from('cs_social_deliveries').select('id,content_item_id,state,scheduled_at,provider_post_id,provider_uuid,receipt,error,checked_at').order('scheduled_at').limit(30)
    if(receipts.error)throw receipts.error
    return NextResponse.json({connected:Boolean(data?.status==='verified' && !data?.last_error?.includes('OAuth invalid_grant') && !data?.last_error?.includes('OAuth invalid_client')),brand:data?.brand_label || null,verifiedAt:data?.verified_at || null,automaticDispatchEnabled:Boolean(data?.dispatch_enabled && data.capabilities_verified && !data.last_error),requiresReconnect:Boolean(data?.last_error?.includes('OAuth invalid_grant') || data?.last_error?.includes('OAuth invalid_client')),deliveryConfigured:Boolean(data?.dispatch_enabled),tokenHealth,lastCheckAt:data?.last_check_at,lastError:data?.last_error,receipts:receipts.data,allowedNetworks:['facebook','threads'],configured:Boolean(process.env.CS_SOCIAL_ENCRYPTION_KEY && process.env.CS_METRICOOL_OAUTH_CLIENT_ID)},{headers:{'Cache-Control':'private, no-store'}})
  }catch{return NextResponse.json({error:'Social connection status unavailable'},{status:503})}
}

export async function POST(req:NextRequest) {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
  try {
    const result=await processSocialDelivery({readOnly:true})
    return NextResponse.json({...result,postsSent:0},{headers:{'Cache-Control':'private, no-store'}})
  }catch{return NextResponse.json({error:'Receipt verification failed. No posts were sent; inspect the connection status.'},{status:503})}
}
