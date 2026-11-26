import { createHmac, timingSafeEqual } from 'node:crypto'
import { galleryWorkSlug, zariaVoiceAgent } from './zaria'
export const VERSION = 'zaria-gallery-turn-v1'
export const PREVIEW_AUDIENCE = 'zaria-private-staging'
export const PRODUCTION_AUDIENCE = 'zaria-approved-production'
export const AUDIENCE = PREVIEW_AUDIENCE
export type ZariaAudience = typeof PREVIEW_AUDIENCE|typeof PRODUCTION_AUDIENCE
export const TTL_MS = 300_000
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ROOM = /^cs-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type Grant = {audience:ZariaAudience;version:typeof VERSION;host:'zaria';room:string;participantIdentity:string;userId:string;conversationId:string;nonce:string;scope:string;iat:number;exp:number;galleryWork:string|null}
type ZariaRuntimeConfig={scope:string;secret:string;members:string[];audience:ZariaAudience;environment:'preview'|'production';livekit:{url:string;key:string;secret:string}}
export function privateZariaConfig(url: string, env:NodeJS.ProcessEnv=process.env):ZariaRuntimeConfig|null {
  // Use the exact Git branch alias only when Vercel confirms the isolated project
  // and branch. Unlike VERCEL_URL, that alias survives an env-config rebuild.
  const pinnedProject=env.CS_ZARIA_PREVIEW_EXPECTED_PROJECT_ID
  const pinnedBranch=env.CS_ZARIA_PREVIEW_EXPECTED_GIT_REF
  const branchPinRequested=pinnedProject!==undefined||pinnedBranch!==undefined
  if(branchPinRequested&&(!pinnedProject||!/^prj_[a-zA-Z0-9]+$/.test(pinnedProject)||
      pinnedProject!==env.VERCEL_PROJECT_ID||!pinnedBranch||pinnedBranch!==env.VERCEL_GIT_COMMIT_REF))return null
  const production=env.VERCEL_ENV==='production'
  const expectedHost=production?env.CS_ZARIA_PRODUCTION_EXPECTED_HOST:env.CS_ZARIA_PREVIEW_EXPECTED_HOST
  const scope=production?expectedHost:(branchPinRequested?env.VERCEL_BRANCH_URL:env.VERCEL_URL)
  const secret=production?env.CS_ZARIA_PRODUCTION_BRIDGE_SECRET:env.CS_ZARIA_PREVIEW_BRIDGE_SECRET
  const members=(production?env.CS_ZARIA_PRODUCTION_USER_IDS:env.CS_ZARIA_PREVIEW_QA_USER_IDS)?.split(',').map(v=>v.trim()).filter(v=>UUID.test(v))??[]
  const enabled=production?env.CS_ZARIA_PRODUCTION_BRIDGE:env.CS_ZARIA_PREVIEW_BRIDGE
  if((production?env.VERCEL_ENV!=='production':env.VERCEL_ENV!=='preview')||enabled!=='true'||env.CS_LIVEKIT_ENABLED!=='true'||!zariaVoiceAgent(env)||
     !scope||scope!==expectedHost||!(production?scope==='www.cafe-sativa.com':/^[-a-z0-9]+\.vercel\.app$/.test(scope))||
     !secret||secret.length<32||secret===env.CS_LIVEKIT_BRIDGE_SECRET||!members.length)return null
  const db=env.NEXT_PUBLIC_SUPABASE_URL
  const selectedDb=production?env.CS_ZARIA_PRODUCTION_SUPABASE_URL:env.CS_ZARIA_PREVIEW_SUPABASE_URL
  const deniedDb=production?env.CS_ZARIA_DENY_PREVIEW_SUPABASE_URL:env.CS_ZARIA_DENY_PRODUCTION_SUPABASE_URL
  if(!db||!selectedDb||!deniedDb||db!==selectedDb||selectedDb===deniedDb)return null
  try{if(new URL(db).protocol!=='https:'||new URL(db).origin===new URL(deniedDb).origin)return null}catch{return null}
  try{if(new URL(url).origin!=='https://'+scope)return null}catch{return null}
  const prefix=production?'CS_ZARIA_PRODUCTION_':'CS_ZARIA_PREVIEW_'
  const livekitUrl=env[prefix+'LIVEKIT_URL']
  const livekitHost=env[prefix+'LIVEKIT_EXPECTED_HOST']
  const livekitKey=env[prefix+'LIVEKIT_API_KEY']
  const livekitSecret=env[prefix+'LIVEKIT_API_SECRET']
  if(!livekitUrl||!livekitHost||!livekitKey?.trim()||!livekitSecret?.trim()||
     livekitKey===env.LIVEKIT_API_KEY||livekitSecret===env.LIVEKIT_API_SECRET)return null
  try{
   const target=new URL(livekitUrl), shared=env.LIVEKIT_URL?new URL(env.LIVEKIT_URL):null
   if(target.protocol!=='wss:'||target.hostname!==livekitHost||!/^[-a-z0-9]+\.livekit\.cloud$/.test(livekitHost)||
      target.port||target.username||target.password||target.pathname!=='/'||target.search||target.hash||
      shared?.hostname===target.hostname)return null
  }catch{return null}
  return {scope,secret,members,audience:production?PRODUCTION_AUDIENCE:PREVIEW_AUDIENCE,environment:production?'production':'preview',livekit:{url:livekitUrl,key:livekitKey,secret:livekitSecret}}
}

export function privateZariaMember(url:string,userId:string|null,env:NodeJS.ProcessEnv=process.env) {
  const config=privateZariaConfig(url,env)
  return config&&userId&&config.members.includes(userId)?config:null
}
function mac(payload:string,secret:string) {
 return createHmac('sha256',secret).update(VERSION+'\0'+payload).digest()
}
export function signZariaGrant(grant:Grant, secret:string) {
 const payload=Buffer.from(JSON.stringify(grant)).toString('base64url')
 return payload+'.'+mac(payload,secret).toString('base64url')
}
export function verifyZariaGrant(token:string,secret:string,scope:string,audience:ZariaAudience,now=Date.now()):Grant|null {
 try{
  if(secret.length<32||token.length>2048||!/^[\w-]+\.[\w-]+$/.test(token))return null
  const [payload,signature]=token.split('.')
  const actual=Buffer.from(signature,'base64url'), expected=mac(payload,secret)
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null
  const v=JSON.parse(Buffer.from(payload,'base64url').toString())
  if(v.version!==VERSION||v.audience!==audience||v.host!=='zaria'||v.scope!==scope||
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
