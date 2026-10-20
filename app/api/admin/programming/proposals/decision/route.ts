import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
const reply=(v:unknown,status=200)=>NextResponse.json(v,{status,headers})
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 if(Number(req.headers.get('content-length'))>2000)return reply({error:'Request too large'},413)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.id!=='string'||!/^[0-9a-f-]{36}$/i.test(b.id)||!['concept_approved','rejected'].includes(b.action)||!['draft','owner_review','revision_requested'].includes(b.expectedStatus))return reply({error:'Invalid decision request'},400)
 const auth=createClient()
 const {data:{user},error:authError}=await auth.auth.getUser()
 if(authError||!user||user.app_metadata?.cafe_sativa_admin!==true)return reply({error:'Unauthorized'},401)
 const db=createAdminClient()
 const result=await db.rpc('cs_decide_programming_proposal',{p_id:b.id,p_expected_status:b.expectedStatus,p_action:b.action,p_actor:user.id})
 if(result.error)return reply({error:'Decision could not be recorded; refresh the proposal and try again'},409)
 return reply({decision:result.data,conceptOnly:true,spendingApproved:false,publicEventCreated:false,renderingStarted:false,publishingStarted:false})
}
