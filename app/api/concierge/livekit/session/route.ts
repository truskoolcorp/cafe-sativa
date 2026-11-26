import {galleryWorkSlug,ZARIA_VOICE,zariaVoiceAgent} from '@/lib/gallery/zaria'
import {VERSION,TTL_MS,privateZariaConfig,signZariaGrant} from '@/lib/gallery/zaria-voice-v1'
import {zariaGrounding} from '@/lib/gallery/zaria-answer'
import {randomUUID} from 'node:crypto'
import {AccessToken,RoomConfiguration,RoomAgentDispatch,TrackSource} from 'livekit-server-sdk'
import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {canonicalConciergeHost} from '@/lib/content/concierge-canon'
import {conversationMatchesRequester} from '@/lib/concierge/conversation-access'
import {signVoiceSession} from '@/lib/concierge/livekit-session'
import {stageHostIsPerforming, STAGE_HOST_ON_STAGE, VOICE_PERFORMANCE_BUFFER_MS} from '@/lib/events/stage-host-availability'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(req:Request) {
 const host=req?.url?new URL(req.url).searchParams.get('host'):null
 if(host==='zaria') {
  const cfg=privateZariaConfig(req.url)
  if(!cfg)return response({available:false})
  try {
   const {data}=await createClient().auth.getUser()
   if(!data.user||data.user.is_anonymous||!cfg.members.includes(data.user.id))return response({available:false})
   return response({available:true})
  } catch {return response({available:false})}
 }
 return response({available:process.env.CS_LIVEKIT_ENABLED==='true' &&
  ['LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','CS_LIVEKIT_AGENT_NAME','CS_LIVEKIT_BRIDGE_SECRET'].every(key=>Boolean(process.env[key]))})
}
export async function POST(req:Request) {
 if(req.headers.get('origin')!==new URL(req.url).origin)return response({error:'Invalid origin'},403)
 if(process.env.CS_LIVEKIT_ENABLED!=='true')return response({error:'Live conversation is not available yet.'},503)
 const agent=process.env.CS_LIVEKIT_AGENT_NAME,bridge=process.env.CS_LIVEKIT_BRIDGE_SECRET
 try {
  const body=await req.json().catch(()=>null)
  if(!body||!['laviche','ginger','ahnika','zaria'].includes(body.host)||typeof body.conversation_id!=='string'||! /^[0-9a-f-]{36}$/i.test(body.conversation_id))return response({error:'Choose a host and an existing conversation.'},400)
  const preview=body.host==='zaria'?privateZariaConfig(req.url):null
  const dispatchAgent=body.host==='zaria'?(preview?zariaVoiceAgent():null):agent
  if(!dispatchAgent)return response({error:body.host==='zaria'?'Zaria’s live voice is not available. You can still chat by text.':'Live conversation is not configured.'},503)
  const key=preview?preview.livekit.key:process.env.LIVEKIT_API_KEY
  const secret=preview?preview.livekit.secret:process.env.LIVEKIT_API_SECRET
  const url=preview?preview.livekit.url:process.env.LIVEKIT_URL
  if(!key||!secret||!url||(!preview&&!bridge))return response({error:'Live conversation is not configured.'},503)
  if(new URL(url).protocol!=='wss:')return response({error:'Live conversation is unavailable.'},503)
  const galleryWork=body.host==='zaria'?galleryWorkSlug(body.gallery_work):null
  if(stageHostIsPerforming(body.host,Date.now(),VOICE_PERFORMANCE_BUFFER_MS))return response({error:STAGE_HOST_ON_STAGE,code:'host_performing'},409)
  const {data:auth}=await createClient().auth.getUser()
  if(!auth.user)return response({error:'Sign in to start live conversation.'},401)
  if(preview&&(auth.user.is_anonymous||!preview.members.includes(auth.user.id)))return response({error:'Private preview only.'},403)
  const db=createAdminClient()
  const row=await db.from('host_conversations').select('user_id,session_id,host_agent,ended_at').eq('id',body.conversation_id).maybeSingle()
  if(row.error)return response({error:'Conversation is temporarily unavailable.'},503)
  if(!conversationMatchesRequester(row.data,{userId:auth.user.id,sessionId:null,host:body.host}))return response({error:'Conversation unavailable.'},403)
  const canonical=await canonicalConciergeHost(body.host)
  if(!canonical)return response({error:'Approved host context is unavailable.'},409)
  const room='cs-'+randomUUID(),identity=randomUUID()
  const issued=Date.now()
  if(preview&&canonical.voiceId!==ZARIA_VOICE.id)return response({error:'Approved voice is not available.'},503)
  const selection=preview&&galleryWork?await zariaGrounding(galleryWork):null
  const verifiedWork=selection?.links.some(link=>link.path==='/gallery/'+galleryWork)?galleryWork:null
  const grant=preview?signZariaGrant({version:VERSION,audience:preview.audience,host:'zaria',scope:preview.scope,room,participantIdentity:identity,conversationId:body.conversation_id,userId:auth.user.id,iat:issued,exp:issued+TTL_MS,nonce:randomUUID(),galleryWork:verifiedWork},preview.secret):signVoiceSession({conversationId:body.conversation_id,host:body.host,userId:auth.user.id,expires:issued+1800000},bridge!)
  const token=new AccessToken(key,secret,{identity,ttl:300})
  token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]})
  token.roomConfig=new RoomConfiguration({agents:[new RoomAgentDispatch({agentName:dispatchAgent,metadata:JSON.stringify({site:'cafe-sativa',host:body.host,voiceId:canonical.voiceId,...(body.host==='zaria'?{voiceModel:ZARIA_VOICE.model}:{}),memoryGrant:grant})})]})
  return response({server_url:url,participant_token:await token.toJwt(),conversation_id:body.conversation_id},201)
 }catch{return response({error:'Live conversation is temporarily unavailable.'},503)}
}

