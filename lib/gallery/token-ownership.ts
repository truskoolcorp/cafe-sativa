/**
 * Read-only ERC-721 ownership checks for approved Gallery collections.
 * This is not authentication: callers must separately verify a signed,
 * session-bound wallet challenge before granting any entitlement.
 */
export type GalleryChain = 'base' | 'polygon' | 'ethereum'
export type OwnershipResult = 'owned' | 'not_owned' | 'unavailable'
const chainIds: Record<GalleryChain, number> = {base:8453,polygon:137,ethereum:1}
const addressPattern = /^0x[0-9a-fA-F]{40}$/
export async function checkGalleryTokenOwner(input: {
  chain: GalleryChain
  rpcUrl: string
  contract: string
  tokenId: string
  wallet: string
}): Promise<OwnershipResult> {
  try {
    if (!addressPattern.test(input.contract) || !addressPattern.test(input.wallet) ||
        !/^[0-9]{1,78}$/.test(input.tokenId)) return 'unavailable'
    const id = BigInt(input.tokenId)
    if (id >= (BigInt(1) << BigInt(256))) return 'unavailable'
    const rpc = new URL(input.rpcUrl)
    if (rpc.protocol !== 'https:') return 'unavailable'
    // RPC URL and contract must come from trusted server configuration, never a visitor.
    async function call(method: string, params: unknown[]) {
      const res = await fetch(rpc, {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
        cache:'no-store',signal:AbortSignal.timeout(8000)})
      if (!res.ok) throw new Error('RPC unavailable')
      const data = await res.json()
      if (data.error || typeof data.result !== 'string') throw new Error('Invalid RPC response')
      return data.result as string
    }
    const chain = await call('eth_chainId',[])
    if (Number(chain) !== chainIds[input.chain]) return 'unavailable'
    const result = await call('eth_call',[{to:input.contract,data:'0x6352211e'+id.toString(16).padStart(64,'0')},'latest'])
    if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(result)) return 'unavailable'
    return ('0x'+result.slice(-40)).toLowerCase() === input.wallet.toLowerCase() ? 'owned' : 'not_owned'
  } catch { return 'unavailable' }
}
