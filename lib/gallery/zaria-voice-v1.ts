import { createHmac, timingSafeEqual } from 'node:crypto'
import { galleryWorkSlug, zariaVoiceAgent } from './zaria'
export const VERSION = 'zaria-gallery-turn-v1'
export const AUDIENCE = 'zaria-private-staging'
export const TTL_MS = 300_000
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ROOM = /^cs-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type Grant = {audience:typeof AUDIENCE;version:typeof VERSION;host:'zaria';room:string;participantIdentity:string;userId:string;conversationId:string;nonce:string;scope:string;iat:number;exp:number;galleryWork:string|null}
export function privateZariaConfig(url: string, env:NodeJS.ProcessEnv=process.env) {
  const scope=env.VERCEL_URL
  const secret=env.CS_ZARIA_PREVIEW_BRIDGE_SECRET
  const members=env.CS_ZARIA_PREVIEW_QA_USER_IDS?.split(',').map(v=>v.trim()).filter(v=>UUID.test(v))??[]
  if(env.VERCEL_ENV!=='preview'||env.CS_ZARIA_PREVIEW_BRIDGE!=='true'||env.CS_LIVEKIT_ENABLED!=='true'||!zariaVoiceAgent(env)||
     !scope||scope!==env.CS_ZARIA_PREVIEW_EXPECTED_HOST||!/^[-a-z0-9]+\.vercel\.app$/.test(scope)||
     !secret||secret.length<32||secret===env.CS_LIVEKIT_BRIDGE_SECRET||!members.length)return null
  const db=env.NEXT_PUBLIC_SUPABASE_URL, previewDb=env.CS_ZARIA_PREVIEW_SUPABASE_URL, productionDb=env.CS_ZARIA_DENY_PRODUCTION_SUPABASE_URL
  if(!db||!previewDb||!productionDb||db!==previewDb||previewDb===productionDb)return null
  try{if(new URL(db).protocol!=='https:'||new URL(db).origin===new URL(productionDb).origin)return null}catch{return null}
  try{if(new URL(url).origin!=='https://'+scope)return null}catch{return null}
  const livekitUrl=env.CS_ZARIA_PREVIEW_LIVEKIT_URL
  const livekitHost=env.CS_ZARIA_PREVIEW_LIVEKIT_EXPECTED_HOST
  const livekitKey=env.CS_ZARIA_PREVIEW_LIVEKIT_API_KEY
  const livekitSecret=env.CS_ZARIA_PREVIEW_LIVEKIT_API_SECRET
  if(!livekitUrl||!livekitHost||!livekitKey?.trim()||!livekitSecret?.trim()||
     livekitKey===env.LIVEKIT_API_KEY||livekitSecret===env.LIVEKIT_API_SECRET)return null
  try{
   const target=new URL(livekitUrl), shared=env.LIVEKIT_URL?new URL(env.LIVEKIT_URL):null
   if(target.protocol!=='wss:'||target.hostname!==livekitHost||!/^[-a-z0-9]+\.livekit\.cloud$/.test(livekitHost)||
      target.port||target.username||target.password||target.pathname!=='/'||target.search||target.hash||
      shared?.hostname===target.hostname)return null
  }catch{return null}
  return {scope,secret,members,livekit:{url:livekitUrl,key:livekitKey,secret:livekitSecret}}
}
function mac(payload:string,secret:string) {
 return createHmac('sha256',secret).update(VERSION+'\0'+payload).digest()
}
export function signZariaGrant(grant:Grant, secret:string) {
 const payload=Buffer.from(JSON.stringify(grant)).toString('base64url')
 return payload+'.'+mac(payload,secret).toString('base64url')
}
export function verifyZariaGrant(token:string,secret:string,scope:string,now=Date.now()):Grant|null {
 try{
  if(secret.length<32||token.length>2048||!/^[\w-]+\.[\w-]+$/.test(token))return null
  const [payload,signature]=token.split('.')
  const actual=Buffer.from(signature,'base64url'), expected=mac(payload,secret)
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null
  const v=JSON.parse(Buffer.from(payload,'base64url').toString())
  if(v.version!==VERSION||v.audience!==AUDIENCE||v.host!=='zaria'||v.scope!==scope||
     typeof v.room!=='string'||!ROOM.test(v.room)||
     ![v.participantIdentity,v.userId,v.conversationId,v.nonce].every(x=>typeof x==='string'&&UUID.test(x))||
     !Number.isSafeInteger(v.iat)||!Number.isSafeInteger(v.exp)||v.iat>now||v.exp<=now||
     v.exp<=v.iat||v.exp-v.iat>TTL_MS||!(v.galleryWork===null||galleryWorkSlug(v.galleryWork)))return null
  return v
 }catch{return null}
}
export function parseZariaBridgeBody(value:unknown,operation:'admit'|'turn') {
 if(!value||typeof value!=='object'||Array.isArray(value))return null
 const v=value as Record<string,unknown>
 if(v.version!==VERSION||typeof v.room!=='string'||!ROOM.test(v.room))return null
 if(operation==='admit')return Object.keys(v).length===2?{room:v.room,utterance:'',eventId:''}:null
 if(Object.keys(v).length!==4||typeof v.event_id!=='string'||!UUID.test(v.event_id)||typeof v.utterance!=='string'||
    v.utterance.length>1600||!v.utterance.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.utterance))return null
 return {room:v.room,utterance:v.utterance.trim(),eventId:v.event_id}
}
export function zariaSpeech(answer:string):string {
 const plain=answer.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/https?:\/\/\S+/gi,'').replace(/[<>*#`_]/g,'').replace(/\s+/g,' ').trim()
 if(plain.length<=600)return plain
 const bounded=plain.slice(0,593), last=bounded.lastIndexOf(' ')
 return (last>500?bounded.slice(0,last):bounded)+'…'
}
