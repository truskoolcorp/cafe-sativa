import { NextRequest,NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CALLBACK,COOKIE,COOKIE_PATH,METRICOOL_MCP,providerJson,seal,validateOAuthState } from '@/lib/content/metricool-oauth'
import { verifyMetricoolConnection } from '@/lib/content/metricool-mcp'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(req:NextRequest) {
  const done=(status:string)=>{const response=NextResponse.redirect(`https://www.cafe-sativa.com/admin?metricool=${status}`);response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');response.cookies.set(COOKIE,'',{httpOnly:true,secure:true,sameSite:'lax',path:COOKIE_PATH,maxAge:0});return response}
  if(!await isContentAdmin())return done('sign_in_required')
  try {
    const {data:{user}}=await createClient().auth.getUser()
    const cookie=req.cookies.get(COOKIE)?.value,code=req.nextUrl.searchParams.get('code')
    if(!user || !cookie || !code || code.length>4096 || req.nextUrl.searchParams.has('error'))return done('not_connected')
    const state=validateOAuthState(cookie,req.nextUrl.searchParams.get('state'),user.id)
    const tokens=await providerJson('/oauth/token',new URLSearchParams({grant_type:'authorization_code',code,client_id:state.clientId,redirect_uri:CALLBACK,code_verifier:state.verifier,resource:METRICOOL_MCP}))
    if(typeof tokens.access_token!=='string' || !tokens.access_token || tokens.token_type?.toLowerCase()!=='bearer' || typeof tokens.refresh_token!=='string' || !tokens.refresh_token)throw new Error('Refreshable OAuth access required')
    const brand=await verifyMetricoolConnection(tokens.access_token)
    const now=new Date().toISOString()
    const result=await createAdminClient().from('cs_social_connections').upsert({provider:'metricool',owner_id:user.id,status:'verified',brand_id:brand.brandId,user_id:brand.userId,brand_label:brand.label,credential_ciphertext:seal({clientId:state.clientId,...tokens,obtainedAt:now},'credentials'),verified_at:now,updated_at:now,dispatch_enabled:false},{onConflict:'provider'})
    if(result.error)throw result.error
    return done('connected')
  }catch{return done('not_connected')}
}
