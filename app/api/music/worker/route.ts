import {NextRequest,NextResponse} from 'next/server'
import {cronAuthorized} from '@/lib/content/auth'
import {processMusicReleases} from '@/lib/content/music-release-server'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(req:NextRequest){
 if(!cronAuthorized(req.headers.get('authorization')))return NextResponse.json({error:'Unauthorized'},{status:401})
 try{return NextResponse.json(await processMusicReleases(),{headers:{'Cache-Control':'private, no-store'}})}catch{return NextResponse.json({error:'Music release handoff unavailable; existing receipts retained'},{status:503})}
}
