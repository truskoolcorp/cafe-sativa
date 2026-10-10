import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
export const METRICOOL_ORIGIN='https://app.metricool.com'
export const METRICOOL_MCP='https://ai.metricool.com/mcp'
export const CALLBACK='https://www.cafe-sativa.com/api/content/social/callback'
export const COOKIE='__Secure-cs_metricool_oauth'
export const COOKIE_PATH='/api/content/social'
const AAD='cafe-sativa:metricool:v1:'
function key() {
  const value=Buffer.from(process.env.CS_SOCIAL_ENCRYPTION_KEY || '','base64')
  if(value.length!==32)throw new Error('Social encryption is not configured')
  return value
}
export function seal(value:unknown,purpose:string) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv)
  cipher.setAAD(Buffer.from(AAD+purpose))
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()])
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url')
}
export function unseal<T>(value:string,purpose:string):T {
  if(value.length>20000)throw new Error('Invalid encrypted payload')
  const bytes=Buffer.from(value,'base64url')
  if(bytes.length<29)throw new Error('Invalid encrypted payload')
  const cipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12))
  cipher.setAAD(Buffer.from(AAD+purpose));cipher.setAuthTag(bytes.subarray(12,28))
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'))
}
export function newOAuthRequest(ownerId:string,clientId:string) {
  const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url')
  const url=new URL(METRICOOL_ORIGIN+'/oauth/authorize')
  url.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:CALLBACK,scope:'mcp:read mcp:write',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:METRICOOL_MCP}).toString()
  return {url:url.toString(),cookie:seal({ownerId,clientId,verifier,state,expires:Date.now()+600000},'oauth-state')}
}
export type OAuthState={ownerId:string;clientId:string;verifier:string;state:string;expires:number}
export function validateOAuthState(cookie:string,state:string|null,ownerId:string) {
  const data=unseal<OAuthState>(cookie,'oauth-state')
  if(!state || data.state!==state || data.ownerId!==ownerId || !Number.isFinite(data.expires) || data.expires<Date.now() || typeof data.verifier!=='string' || typeof data.clientId!=='string')throw new Error('OAuth request expired or mismatched')
  return data
}
export async function providerJson(path:'/oauth/token',body:object|URLSearchParams) {
  const form=body instanceof URLSearchParams
  const response=await fetch(METRICOOL_ORIGIN+path,{method:'POST',headers:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'},body:form?body.toString():JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)})
  if(!response.ok)throw new Error('Metricool authorization service rejected the request')
  const text=await response.text()
  if(text.length>50000)throw new Error('Invalid Metricool response')
  return JSON.parse(text)
}
