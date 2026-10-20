import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const TYPES=['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety'] as const
const respond=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(req:NextRequest){
 if(!await isContentAdmin())return respond({error:'Unauthorized'},401)
 const id=req.nextUrl.searchParams.get('promoId')
 if(!id||!/^[a-f0-9-]{36}$/i.test(id))return respond({error:'Invalid draft ID'},400)
 const db=createAdminClient()
 const draft=await db.from('cs_character_promo_drafts').select('video_asset_path,video_qa_approved_at').eq('id',id).maybeSingle()
 if(draft.error||!draft.data)return respond({error:'Draft unavailable'},404)
 const sha=draft.data.video_asset_path?.match(/\/([a-f0-9]{64})\.mp4$/)?.[1]||null
 const result=sha?await db.from('cs_character_promo_qa_checks').select('check_name,result,evidence,created_at').eq('promo_id',id).eq('video_sha256',sha):null
 if(result?.error)return respond({error:'Checks unavailable'},503)
 return respond({promoId:id,sha256:sha,checks:TYPES.map(name=>({name,observation:result?.data?.find(v=>v.check_name===name)||null})),approvalRecorded:Boolean(draft.data.video_qa_approved_at),automaticallyApproved:false})
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return respond({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return respond({error:'Invalid origin'},403)
 if(Number(req.headers.get('content-length'))>4000)return respond({error:'Request too large'},413)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.promoId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.promoId)||!TYPES.includes(b.checkName)||!['pass','fail','needs_review'].includes(b.result)||typeof b.evidence!=='string'||b.evidence.length>1000)return respond({error:'Invalid QA observation'},400)
 const db=createAdminClient()
 const draft=await db.from('cs_character_promo_drafts').select('video_asset_path').eq('id',b.promoId).maybeSingle()
 const sha=draft.data?.video_asset_path?.match(/\/([a-f0-9]{64})\.mp4$/)?.[1]
 if(draft.error||!sha)return respond({error:'No finalized hash-addressed video to review'},409)
 const auth=(await (await import('@/lib/supabase/server')).createClient().auth.getUser())
 const actor=auth.data?.user?.id
 if(!actor)return respond({error:'Missing reviewer identity'},401)
 const save=await db.from('cs_character_promo_qa_checks').upsert({promo_id:b.promoId,video_sha256:sha,check_name:b.checkName,result:b.result,evidence:b.evidence,reviewer_id:actor},{onConflict:'promo_id,video_sha256,check_name'}).select('id').single()
 if(save.error)return respond({error:'Cannot record QA observation'},503)
 return respond({saved:true,sha256:sha,qaApproved:false,publicationApproved:false},201)
}
