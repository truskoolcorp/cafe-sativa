import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 const {data,error}=await createAdminClient().from('cs_member_library').select('id,kind,title,description,details,external_url,status,created_at').eq('kind','recipe').order('created_at',{ascending:false}).limit(100)
 return error?NextResponse.json({error:'Unable to load recipes'},{status:503}):NextResponse.json({items:data||[]},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
 let body:any;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const title=typeof body.title==='string'?body.title.trim():''
 const description=typeof body.description==='string'?body.description.trim():''
 const details=typeof body.details==='string'?body.details.trim():''
 const url=typeof body.external_url==='string'?body.external_url.trim():''
 if(!title||title.length>240||description.length>2500||!details||details.length>12000)return NextResponse.json({error:'Provide a title and recipe instructions within size limits'},{status:400})
 if(url){try{if(new URL(url).protocol!=='https:')throw Error()}catch{return NextResponse.json({error:'Resource URL must be HTTPS'},{status:400})}}
 const publish=body.action==='publish'
 if(publish&&body.confirmReviewed!==true)return NextResponse.json({error:'Confirm editorial review before publishing'},{status:400})
 if(body.action!=='publish'&&body.action!=='draft')return NextResponse.json({error:'Invalid action'},{status:400})
 const db=createAdminClient()
 const payload={kind:'recipe',title,description,details,external_url:url||null,status:publish?'published':'draft',approved_at:publish?new Date().toISOString():null,published_at:publish?new Date().toISOString():null}
 const {data,error}=await db.from('cs_member_library').insert(payload).select('id,status').single()
 if(error)return NextResponse.json({error:'Unable to save recipe'},{status:503})
 return NextResponse.json({item:data},{headers:{'Cache-Control':'private, no-store'}})
}