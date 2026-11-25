import { createElement } from 'react'
import { ImageResponse } from 'next/og'
import { NextRequest,NextResponse } from 'next/server'
import { approvedHostPortrait } from '@/lib/content/host-portraits'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
export async function GET(req:NextRequest) {
  try {
    const host=req.nextUrl.searchParams.get('host') || ''
    const portrait=await approvedHostPortrait(host)
    if(!portrait)return NextResponse.json({error:'Approved host portrait unavailable'},{status:404,headers})
    // Never serve the canonical master directly for Zaria. Render only resized, metadata-free display pixels.
    if(host==='zaria') {
      const image = createElement('div',{style:{display:'flex',width:'100%',height:'100%',backgroundColor:'#17120f'}},
        createElement('img',{src:`data:${portrait.mime};base64,${portrait.bytes.toString('base64')}`,width:448,height:560,style:{objectFit:'contain'}}))
      return new ImageResponse(image,{width:448,height:560,headers})
    }
    return new NextResponse(portrait.bytes,{headers:{...headers,'Content-Type':portrait.mime}})
  }catch{return NextResponse.json({error:'Canonical source unavailable'},{status:503,headers})}
}
