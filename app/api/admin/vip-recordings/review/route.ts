import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
 let body:Record<string,unknown>;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid request'},{status:400})}
 const id=typeof body.id==='string'?body.id:''
 const action=body.action
 if(!/^[0-9a-f-]{36}$/i.test(id)||!['approve','release'].includes(String(action))||body.confirmReviewed!==true)return NextResponse.json({error:'Valid recording, action and explicit review confirmation required'},{status:400})
 const db=createAdminClient()
 const {data:item,error}=await db.from('cs_vip_recordings').select('id,status,storage_bucket,storage_path,approved_at').eq('id',id).single()
 if(error||!item)return NextResponse.json({error:'Recording not found'},{status:404})
 if(action==='approve'&&item.status!=='draft')return NextResponse.json({error:'Only drafts can be approved'},{status:409})
 if(action==='release'&&(item.status!=='approved'||!item.approved_at))return NextResponse.json({error:'Recording must be approved before release'},{status:409})
 const bucket=await db.storage.getBucket(item.storage_bucket)
 if(bucket.error||!bucket.data||bucket.data.public)return NextResponse.json({error:'Private storage verification failed'},{status:409})
 const parts=String(item.storage_path).split('/'),filename=parts.pop()||''
 const files=await db.storage.from(item.storage_bucket).list(parts.join('/')||undefined,{search:filename,limit:100})
 if(files.error||!files.data?.some(f=>f.name===filename&&f.id))return NextResponse.json({error:'Private recording file missing'},{status:409})
 const now=new Date().toISOString()
 const next=action==='approve'?{status:'approved',approved_at:now}:{status:'published',release_at:now}
 const result=await db.from('cs_vip_recordings').update(next).eq('id',id).eq('status',item.status).select('id,status').maybeSingle()
 if(result.error||!result.data)return NextResponse.json({error:'State changed or transition failed; refresh inventory'},{status:409})
 return NextResponse.json({recording:result.data},{headers:{'Cache-Control':'private, no-store'}})
}