import { NextRequest,NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/content/auth'
import { processSocialDelivery } from '@/lib/content/social-delivery'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(req:NextRequest) {
  if(!cronAuthorized(req.headers.get('authorization')))return NextResponse.json({error:'Unauthorized'},{status:401})
  try{return NextResponse.json(await processSocialDelivery({readOnly:true}),{headers:{'Cache-Control':'no-store'}})}
  catch{return NextResponse.json({error:'Social verification failed; inspect administrator connection status.'},{status:503})}
}
