import {verifyVoiceSession} from '@/lib/concierge/livekit-session'
import {createAdminClient} from '@/lib/supabase/admin'
import {canonicalConciergeHost} from '@/lib/content/concierge-canon'
import {conversationMatchesRequester} from '@/lib/concierge/conversation-access'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(req:Request) {
 if(process.env.CS_LIVEKIT_ENABLED!=='true')return response({error:'Unavailable'},503)
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||''
 const grant=verifyVoiceSession(token,process.env.CS_LIVEKIT_BRIDGE_SECRET||'')
 if(!grant)return response({error:'Unauthorized'},401)
 try {
  const db=createAdminClient()
  const row=await db.from('host_conversations').select('user_id,session_id,host_agent,ended_at').eq('id',grant.conversationId).maybeSingle()
  if(row.error)throw row.error
  if(!conversationMatchesRequester(row.data,{userId:grant.userId,sessionId:null,host:grant.host}))return response({error:'Conversation unavailable'},403)
  const canonical=await canonicalConciergeHost(grant.host)
  if(!canonical)return response({error:'Canonical host unavailable'},409)
  const messages=await db.from('host_messages').select('role,content,created_at').eq('conversation_id',grant.conversationId).in('role',['user','assistant']).order('created_at',{ascending:false}).limit(20)
  if(messages.error)throw messages.error
  return response({host:grant.host,canonical,messages:(messages.data||[]).reverse()})
 }catch{return response({error:'Memory temporarily unavailable'},503)}
}

