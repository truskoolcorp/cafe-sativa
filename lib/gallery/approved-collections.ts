import { checkGalleryTokenOwner, type GalleryChain } from './token-ownership'

export type CollectorBenefit = 'gallery_preview' | 'artist_session' | 'collector_exhibition'
export type ApprovedCollection = {
  id: string
  chain: GalleryChain
  contract: string
  tokenIds: readonly string[]
  benefits: readonly CollectorBenefit[]
  active: boolean
}

// Empty by design until owner-approved contracts and token ranges are verified.
// Never populate from browser input or arbitrary marketplace listings.
export const approvedCollections: readonly ApprovedCollection[] = []

export function findApprovedCollection(id: string, tokenId: string) {
  return approvedCollections.find(c => c.active && c.id === id && c.tokenIds.includes(tokenId))
}

// Informational ownership only. This helper must NOT authorize protected routes.
// A server-side session-bound wallet signature verifier and fresh ownership
// check are required before any entitlement can be granted.
export async function inspectApprovedToken(input: {
  collectionId: string
  tokenId: string
  wallet: string
  rpcUrls: Partial<Record<GalleryChain,string>>
}) {
  const collection = findApprovedCollection(input.collectionId,input.tokenId)
  if (!collection) return {status:'unapproved' as const}
  const rpcUrl = input.rpcUrls[collection.chain]
  if (!rpcUrl) return {status:'unavailable' as const}
  const status = await checkGalleryTokenOwner({chain:collection.chain,contract:collection.contract,tokenId:input.tokenId,wallet:input.wallet,rpcUrl})
  return {status}
}
