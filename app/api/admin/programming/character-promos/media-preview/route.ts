import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const HEADERS={'Cache-Control':'private, no-store'}
export async function GET(req:NextRequest){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers:HEADERS})
 const id=req.nextUrl.searchParams.get('promoId')||''
 if(!/^[a-f0-9-]{36}$/i.test(id))return NextResponse.json({error:'Invalid promo'},{status:400,headers:HEADERS})
 const db=createAdminClient()
 const r=await db.from('cs_character_promo_drafts').select('id,character_id,video_asset_path,video_qa_approved_at').eq('id',id).maybeSingle()
 if(r.error||!r.data?.video_asset_path)return NextResponse.json({error:'Private clip unavailable'},{status:404,headers:HEADERS})
 const expected=new RegExp('^character-promos/'+r.data.character_id+'/'+id+'/[a-f0-9]{64}\\.mp4$')
 if(!expected.test(r.data.video_asset_path))return NextResponse.json({error:'Unsafe clip reference'},{status:409,headers:HEADERS})
 const signed=await db.storage.from('cafe-sativa-content').createSignedUrl(r.data.video_asset_path,300)
 if(signed.error||!signed.data?.signedUrl)return NextResponse.json({error:'Preview unavailable'},{status:503,headers:HEADERS})
 return NextResponse.json({previewUrl:signed.data.signedUrl,expiresInSeconds:300,qaApproved:Boolean(r.data.video_qa_approved_at),publicationApproved:false},{headers:HEADERS})
}
