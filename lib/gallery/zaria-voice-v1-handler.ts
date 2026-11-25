import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { conversationMatchesRequester } from '@/lib/concierge/conversation-access'
import { canonicalConciergeHost } from '@/lib/content/concierge-canon'
import { chronologicalMessages } from '@/lib/concierge/history'
import { stageHostIsPerforming } from '@/lib/events/stage-host-availability'
import { getHost } from '@/lib/concierge/personas'
import { generateConciergeResponse } from '@/lib/concierge/response-engine'
import { zariaGrounding } from './zaria-answer'
import { ZARIA_VOICE } from './zaria'
import { AUDIENCE,VERSION,parseZariaBridgeBody,privateZariaConfig,verifyZariaGrant,zariaSpeech } from './zaria-voice-v1'

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
const fail=(status:number)=>json({authorized:false},status)

export async function zariaBridge(req:Request,operation:'admit'|'turn') {
 const config=privateZariaConfig(req.url)
 if(!config)return fail(404)
 if(req.headers.has('origin')||req.headers.has('cookie'))return fail(403)
 const auth=/^Bearer ([\w.-]+)$/.exec(req.headers.get('authorization')??'')
 const grant=auth&&verifyZariaGrant(auth[1],config.secret,config.scope)
 if(!grant||!config.members.includes(grant.userId))return fail(401)
 if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get('content-type')??''))return fail(415)
 try{
  const reader=req.body?.getReader()
  if(!reader)return fail(400)
  const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text=''
  while(true) {
   const chunk=await reader.read();if(chunk.done)break
   bytes+=chunk.value.length
   if(bytes>10500){await reader.cancel();return fail(413)}
   text+=decoder.decode(chunk.value,{stream:true})
  }
  const value=(()=>{try{return JSON.parse(text+decoder.decode())}catch{return null}})()
  const body=parseZariaBridgeBody(value,operation)
  if(!body)return fail(400)
  if(body.room!==grant.room||Date.now()>=grant.exp)return fail(403)
  const db=createAdminClient()
  async function isOwned() {
   const row=await db.from('host_conversations').select('user_id,session_id,host_agent,ended_at').eq('id',grant!.conversationId).maybeSingle()
   if(row.error)throw row.error
   return conversationMatchesRequester(row.data,{userId:grant!.userId,sessionId:null,host:'zaria'})
  }
  if(!await isOwned()||Date.now()>=grant.exp)return fail(403)
  if(stageHostIsPerforming('zaria'))return fail(409)
  const canonical=await canonicalConciergeHost('zaria')
  if(!canonical||canonical.voiceId!==ZARIA_VOICE.id)return fail(503)
  const base={version:VERSION,audience:AUDIENCE,authorized:true,room:grant.room,host:'zaria',voice_id:ZARIA_VOICE.id,model_id:ZARIA_VOICE.model}
  if(operation==='admit')return Date.now()<grant.exp?json({...base,participant_identity:grant.participantIdentity}):fail(403)
  const key=process.env.ANTHROPIC_API_KEY
  if(process.env.CS_ZARIA_PREVIEW_INFERENCE!=='true'||!key)return fail(503)
  const reservation=await db.rpc('reserve_zaria_preview_voice_turn',{p_nonce:grant.nonce,p_event:body.eventId,p_user:grant.userId,p_conversation:grant.conversationId,p_utterance:body.utterance})
  if(reservation.error)return fail(503)
  if(reservation.data?.status==='forbidden')return fail(403)
  if(reservation.data?.status==='limited')return fail(429)
  if(reservation.data?.status==='conflict'||reservation.data?.status==='pending')return fail(409)
  if(reservation.data?.status==='replay'&&typeof reservation.data.speech==='string')return Date.now()<grant.exp?json({...base,speech:reservation.data.speech}):fail(403)
  if(reservation.data?.status!=='reserved')return fail(503)
  const [gallery,recent,voice]=await Promise.all([
   zariaGrounding(grant.galleryWork),
   db.from('host_messages').select('role,content,created_at').eq('conversation_id',grant.conversationId).in('role',['user','assistant']).order('created_at',{ascending:false}).limit(20),
   db.from('zaria_preview_voice_turns').select('utterance,speech,created_at').eq('grant_nonce',grant.nonce).eq('user_id',grant.userId).not('speech','is',null).order('created_at',{ascending:false}).limit(7),
  ])
  if(recent.error||voice.error||!await isOwned()||Date.now()>=grant.exp)return fail(503)
  const chronology=[...chronologicalMessages(recent.data??[]).map(m=>({role:m.role as 'user'|'assistant',content:m.content,created_at:m.created_at})),
   ...(voice.data??[]).flatMap(v=>[{role:'user' as const,content:v.utterance,created_at:v.created_at},{role:'assistant' as const,content:String(v.speech),created_at:v.created_at}])]
   .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))
  const anthropic=new Anthropic({apiKey:key,timeout:12000,maxRetries:0})
  const reply=await generateConciergeResponse({
   hostSystemPrompt:getHost('zaria')!.system_prompt,
   canonicalContext:canonical.context,
   liveProgramming:gallery.liveProgramming,
   messages:[...chronology.map(m=>({role:m.role,content:m.content})),{role:'user',content:body.utterance}],
  },request=>anthropic.messages.create(request))
  const speech=zariaSpeech(reply)
  if(!speech||stageHostIsPerforming('zaria')||!await isOwned()||Date.now()>=grant.exp)return fail(503)
  const save=await db.from('zaria_preview_voice_turns').update({speech}).eq('grant_nonce',grant.nonce).eq('event_id',body.eventId).eq('user_id',grant.userId).eq('conversation_id',grant.conversationId).is('speech',null).select('event_id').single()
  if(save.error||!save.data||Date.now()>=grant.exp)return fail(503)
  return json({...base,speech,gallery_links:gallery.links})
 }catch{return fail(503)}
}
