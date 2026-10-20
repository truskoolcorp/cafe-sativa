import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 const {data,error}=await createAdminClient().from('cs_vip_recordings')
  .select('id,title,description,status,release_at,approved_at,created_at')
  .order('created_at',{ascending:false}).limit(100)
 if(error)return NextResponse.json({error:'Unable to load recording inventory'},{status:503,headers:{'Cache-Control':'private, no-store'}})
 return NextResponse.json({recordings:data||[]},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
 let body:Record<string,unknown>
 try{body=await req.json()}catch{return NextResponse.json({error:'Invalid input'},{status:400})}
 const title=typeof body.title==='string'?body.title.trim():''
 const description=typeof body.description==='string'?body.description.trim():''
 const bucket=typeof body.storage_bucket==='string'?body.storage_bucket.trim():''
 const path=typeof body.storage_path==='string'?body.storage_path.trim():''
 if(!title||title.length>240||description.length>2500||!bucket||!path||path.startsWith('/')||path.includes('..')||!/^[-a-z0-9_]+$/.test(bucket)||!/^[a-zA-Z0-9_./-]+$/.test(path))return NextResponse.json({error:'Invalid title or private storage reference'},{status:400})
 const db=createAdminClient()
 const bucketInfo=await db.storage.getBucket(bucket)
 if(bucketInfo.error||!bucketInfo.data||bucketInfo.data.public)return NextResponse.json({error:'A configured private storage bucket is required'},{status:400})
 const segments=path.split('/')
 const filename=segments.pop()||''
 const folder=segments.join('/')
 const {data:objects,error:listError}=await db.storage.from(bucket).list(folder||undefined,{search:filename,limit:100})
 if(listError||!objects?.some(o=>o.name===filename&&o.id))return NextResponse.json({error:'Recording file not found in private storage'},{status:400})
 const saved=await db.from('cs_vip_recordings').insert({title,description,storage_bucket:bucket,storage_path:path,status:'draft'}).select('id,status').single()
 if(saved.error)return NextResponse.json({error:saved.error.code==='23505'?'Recording already registered':'Unable to register recording'},{status:saved.error.code==='23505'?409:503})
 return NextResponse.json({recording:saved.data},{headers:{'Cache-Control':'private, no-store'}})
}
