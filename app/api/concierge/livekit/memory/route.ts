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


/** Store a completed voice turn. The worker supplies one stable UUID per event. */
export async function POST(req:Request) {
 if(process.env.CS_LIVEKIT_ENABLED!=='true')return response({error:'Unavailable'},503)
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||''
 const grant=verifyVoiceSession(token,process.env.CS_LIVEKIT_BRIDGE_SECRET||'')
 if(!grant)return response({error:'Unauthorized'},401)
 try {
  const body=await req.json().catch(()=>null)
  if(!body || typeof body.event_id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.event_id) ||
     !['user','assistant'].includes(body.role) || typeof body.content!=='string' ||
     !body.content.trim() || body.content.length>4000) return response({error:'Invalid completed voice turn'},400)
  const db=createAdminClient()
  const row=await db.from('host_conversations').select('user_id,session_id,host_agent,ended_at').eq('id',grant.conversationId).maybeSingle()
  if(row.error)throw row.error
  if(!conversationMatchesRequester(row.data,{userId:grant.userId,sessionId:null,host:grant.host}))return response({error:'Conversation unavailable'},403)
  if(!await canonicalConciergeHost(grant.host))return response({error:'Canonical host unavailable'},409)
  const matches=(entry:any)=>entry && entry.conversation_id===grant.conversationId && entry.role===body.role && entry.content===body.content
  const previous=await db.from('host_messages').select('conversation_id,role,content').eq('id',body.event_id).maybeSingle()
  if(previous.error)throw previous.error
  if(previous.data)return matches(previous.data)?response({saved:true,duplicate:true}):response({error:'Voice event conflicts with an existing turn'},409)
  const recent=await db.from('host_messages').select('id',{count:'exact',head:true}).eq('conversation_id',grant.conversationId).gte('created_at',new Date(Date.now()-60000).toISOString())
  if(recent.error)throw recent.error
  if((recent.count||0)>=60)return response({error:'Too many voice turns; retry shortly'},429)
  const saved=await db.from('host_messages').insert({id:body.event_id,conversation_id:grant.conversationId,role:body.role,content:body.content})
  if(saved.error) {
   if(saved.error.code!=='23505')throw saved.error
   // Concurrent delivery of the same event is safe; never overwrite a prior turn.
   const existing=await db.from('host_messages').select('conversation_id,role,content').eq('id',body.event_id).maybeSingle()
   if(existing.error)throw existing.error
   return matches(existing.data)?response({saved:true,duplicate:true}):response({error:'Voice event conflicts with an existing turn'},409)
  }
  return response({saved:true,duplicate:false},201)
 }catch{return response({error:'Memory temporarily unavailable; retry the same voice event'},503)}
}
