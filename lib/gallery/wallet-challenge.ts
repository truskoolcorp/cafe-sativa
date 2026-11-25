import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'

// Server-only challenge envelope. Signature recovery and atomic nonce consumption
// must be implemented before this can be used to authorize collector access.
type Challenge = { userId: string; wallet: string; nonce: string; expiresAt: number; domain: string }
const walletPattern = /^0x[0-9a-fA-F]{40}$/
function mac(payload: string, secret: string) {
  if (Buffer.byteLength(secret) < 32) throw new Error('Challenge secret too short')
  return createHmac('sha256',secret).update(payload).digest()
}
export function issueGalleryChallenge(userId: string, wallet: string, domain: string, secret: string) {
  if (!userId || !walletPattern.test(wallet) || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error('Invalid challenge context')
  const challenge: Challenge = {userId,wallet:wallet.toLowerCase(),domain,nonce:randomBytes(32).toString('hex'),expiresAt:Date.now()+300000}
  const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url')
  return {challenge, envelope:payload+'.'+mac(payload,secret).toString('base64url'), message:galleryChallengeMessage(challenge)}
}
export function galleryChallengeMessage(c: Challenge) {
  return [c.domain+' requests wallet verification for Café Sativa Gallery.', 'Wallet: '+c.wallet, 'Nonce: '+c.nonce, 'Expires: '+new Date(c.expiresAt).toISOString(), 'Purpose: verify wallet control only; no transaction or payment.'].join('\n')
}
export function readGalleryChallenge(envelope: string, userId: string, domain: string, secret: string): Challenge | null {
  try {
    if (envelope.length>4096) return null
    const parts=envelope.split('.')
    if(parts.length!==2) return null
    const [payload,signature]=parts
    const actual=Buffer.from(signature,'base64url'), expected=mac(payload,secret)
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return null
    const c=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as Challenge
    if(c.userId!==userId || c.domain!==domain || !walletPattern.test(c.wallet) || !/^[0-9a-f]{64}$/.test(c.nonce) || !Number.isFinite(c.expiresAt) || c.expiresAt<=Date.now()) return null
    return c
  } catch { return null }
}
