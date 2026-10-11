import {createHmac,timingSafeEqual} from 'node:crypto'
export type VoiceSession={conversationId:string;host:'laviche'|'ginger'|'ahnika';userId:string;expires:number}
export function signVoiceSession(session:VoiceSession,secret:string) {
 const payload=Buffer.from(JSON.stringify(session)).toString('base64url')
 return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url')
}
export function verifyVoiceSession(token:string,secret:string,now=Date.now()):VoiceSession|null {
 try {
  if(!secret || token.length>2048)return null
  const parts=token.split('.');if(parts.length!==2)return null
  const signature=Buffer.from(parts[1],'base64url'),expected=createHmac('sha256',secret).update(parts[0]).digest()
  if(signature.length!==expected.length || !timingSafeEqual(signature,expected))return null
  const value=JSON.parse(Buffer.from(parts[0],'base64url').toString())
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if(!uuid.test(value.conversationId)||!uuid.test(value.userId)||!['laviche','ginger','ahnika'].includes(value.host)||!Number.isSafeInteger(value.expires)||value.expires<=now||value.expires>now+1800000)return null
  return value
 }catch{return null}
}

