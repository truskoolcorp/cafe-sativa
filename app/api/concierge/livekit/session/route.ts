import {randomUUID} from 'node:crypto'
import {AccessToken,RoomConfiguration,RoomAgentDispatch,TrackSource} from 'livekit-server-sdk'
import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {canonicalConciergeHost} from '@/lib/content/concierge-canon'
import {conversationMatchesRequester} from '@/lib/concierge/conversation-access'
import {signVoiceSession} from '@/lib/concierge/livekit-session'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(req:Request) {
 if(req.headers.get('origin')!==new URL(req.url).origin)return response({error:'Invalid origin'},403)
 if(process.env.CS_LIVEKIT_ENABLED!=='true')return response({error:'Live conversation is not available yet.'},503)
 const key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET,url=process.env.LIVEKIT_URL,agent=process.env.CS_LIVEKIT_AGENT_NAME,bridge=process.env.CS_LIVEKIT_BRIDGE_SECRET
 if(!key||!secret||!url||!agent||!bridge)return response({error:'Live conversation is not configured.'},503)
 try {
  if(new URL(url).protocol!=='wss:')return response({error:'Live conversation is unavailable.'},503)
  const body=await req.json().catch(()=>null)
  if(!body||!['laviche','ginger','ahnika'].includes(body.host)||typeof body.conversation_id!=='string'||! /^[0-9a-f-]{36}$/i.test(body.conversation_id))return response({error:'Choose a host and an existing conversation.'},400)
  const {data:auth}=await createClient().auth.getUser()
  if(!auth.user)return response({error:'Sign in to start live conversation.'},401)
  const db=createAdminClient()
  const row=await db.from('host_conversations').select('user_id,session_id,host_agent,ended_at').eq('id',body.conversation_id).maybeSingle()
  if(row.error)return response({error:'Conversation is temporarily unavailable.'},503)
  if(!conversationMatchesRequester(row.data,{userId:auth.user.id,sessionId:null,host:body.host}))return response({error:'Conversation unavailable.'},403)
  const canonical=await canonicalConciergeHost(body.host)
  if(!canonical)return response({error:'Approved host context is unavailable.'},409)
  const room='cs-'+randomUUID(),identity=randomUUID()
  const grant=signVoiceSession({conversationId:body.conversation_id,host:body.host,userId:auth.user.id,expires:Date.now()+1800000},bridge)
  const token=new AccessToken(key,secret,{identity,ttl:300})
  token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]})
  token.roomConfig=new RoomConfiguration({agents:[new RoomAgentDispatch({agentName:agent,metadata:JSON.stringify({site:'cafe-sativa',host:body.host,voiceId:canonical.voiceId,memoryGrant:grant})})]})
  return response({server_url:url,participant_token:await token.toJwt(),conversation_id:body.conversation_id},201)
 }catch{return response({error:'Live conversation is temporarily unavailable.'},503)}
}

