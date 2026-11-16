import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {glyphPortrait} from '@/lib/content/glyph-live'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
export async function GET(req:NextRequest) {
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 try {
  const portrait=await glyphPortrait(req.nextUrl.searchParams.get('characterId')||'',req.nextUrl.searchParams.get('assetId')||'')
  if(!portrait)return NextResponse.json({error:'Approved primary changed or unavailable. Refresh references.'},{status:409,headers})
  return new NextResponse(portrait.bytes,{headers:{...headers,'Content-Type':portrait.mime}})
 }catch{return NextResponse.json({error:'Canonical portrait unavailable'},{status:503,headers})}
}
