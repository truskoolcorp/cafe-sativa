import { NextRequest,NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createClient } from '@/lib/supabase/server'
import { COOKIE,COOKIE_PATH,newOAuthRequest } from '@/lib/content/metricool-oauth'
export const dynamic='force-dynamic'
export async function POST(req:NextRequest) {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==req.nextUrl.origin || req.nextUrl.origin!=='https://www.cafe-sativa.com')return NextResponse.json({error:'Use the production Café Sativa website to connect'},{status:403})
  try {
    const {data:{user}}=await createClient().auth.getUser()
    if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
    const clientId=process.env.CS_METRICOOL_OAUTH_CLIENT_ID
    if(!clientId)throw new Error('OAuth client configuration missing')
    const state=newOAuthRequest(user.id,clientId)
    const response=NextResponse.json({url:state.url},{headers:{'Cache-Control':'private, no-store'}})
    response.cookies.set(COOKIE,state.cookie,{httpOnly:true,secure:true,sameSite:'lax',path:COOKIE_PATH,maxAge:600})
    return response
  }catch{return NextResponse.json({error:'Metricool connection could not start. No social posts were sent.'},{status:503})}
}
