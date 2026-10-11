import { NextRequest,NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
export async function POST(req:NextRequest) {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
  return NextResponse.json({error:'Video speech is held until its provider avatar and session ownership are verified against the approved GLYPH primary. Use Ask voice conversations.'},{status:409})
}
