import { NextRequest,NextResponse } from 'next/server'
import { approvedHostPortrait } from '@/lib/content/host-portraits'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
export async function GET(req:NextRequest) {
  try {
    const portrait=await approvedHostPortrait(req.nextUrl.searchParams.get('host') || '')
    if(!portrait)return NextResponse.json({error:'Approved host portrait unavailable'},{status:404,headers})
    return new NextResponse(portrait.bytes,{headers:{...headers,'Content-Type':portrait.mime}})
  }catch{return NextResponse.json({error:'Canonical source unavailable'},{status:503,headers})}
}
