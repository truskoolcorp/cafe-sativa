import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createDirectHeyGenApi,inspectDirectHeyGen} from '@/lib/content/character-production-heygen-direct'
export const dynamic='force-dynamic'
export const runtime='nodejs'
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}
/** Read-only GET inventory. No key values, private media URLs or paid calls. */
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 if(!process.env.HEYGEN_API_KEY)return NextResponse.json({configured:false,ready:false},{status:503,headers})
 try{return NextResponse.json(await inspectDirectHeyGen(createDirectHeyGenApi(()=>process.env.HEYGEN_API_KEY)),{headers})}
 catch{return NextResponse.json({configured:true,ready:false,error:'Provider inventory unavailable; no content created.'},{status:503,headers})}
}
