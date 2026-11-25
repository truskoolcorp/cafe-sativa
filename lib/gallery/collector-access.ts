import { readGalleryChallenge, galleryChallengeMessage } from './wallet-challenge'
import { findApprovedCollection, inspectApprovedToken, type CollectorBenefit } from './approved-collections'
import type { GalleryChain } from './token-ownership'

// All dependencies must be trusted server implementations. In particular,
// consumeNonce must atomically insert a unique nonce and reject duplicates.
// Do not expose this helper as an HTTP endpoint until those adapters exist.
type Dependencies = {
  verifySignature: (message: string, signature: string, wallet: string) => Promise<boolean>
  consumeNonce: (nonce: string, expiresAt: number) => Promise<boolean>
  rpcUrls: Partial<Record<GalleryChain,string>>
}
export async function verifyCollectorAccess(input: {
  envelope: string; signature: string; userId: string; domain: string;
  secret: string; collectionId: string; tokenId: string; benefit: CollectorBenefit
}, deps: Dependencies): Promise<boolean> {
  try {
    if (!input.userId || !input.signature || input.signature.length > 4096) return false
    const challenge = readGalleryChallenge(input.envelope,input.userId,input.domain,input.secret)
    if (!challenge) return false
    const collection = findApprovedCollection(input.collectionId,input.tokenId)
    if (!collection || !collection.benefits.includes(input.benefit)) return false
    if (!await deps.verifySignature(galleryChallengeMessage(challenge),input.signature,challenge.wallet)) return false
    if (challenge.expiresAt <= Date.now()) return false
    if (!await deps.consumeNonce(challenge.nonce,challenge.expiresAt)) return false
    const result = await inspectApprovedToken({collectionId:input.collectionId,tokenId:input.tokenId,wallet:challenge.wallet,rpcUrls:deps.rpcUrls})
    return result.status === 'owned' && challenge.expiresAt > Date.now()
  } catch { return false }
}
