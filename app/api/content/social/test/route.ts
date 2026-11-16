import { NextRequest,NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { withSocialConnection } from '@/lib/content/social-connection'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function POST(req:NextRequest) {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
  try {
    const result=await withSocialConnection(async({brand})=>({verified:true,brand:brand.label,timezone:brand.timezone,allowedNetworks:brand.networks,postsSent:0}))
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}})
  }catch{return NextResponse.json({error:'Connection or tool-contract check failed. No posts were sent; reconnect if needed.'},{status:503})}
}
