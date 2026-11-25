'use client'

import { useEffect, useState } from 'react'

type Provider = {
  request: (args: { method: string }) => Promise<unknown>
  on?: (event: string, listener: () => void) => void
  removeListener?: (event: string, listener: () => void) => void
}
function provider(): Provider | undefined {
  return (window as unknown as { ethereum?: Provider }).ethereum
}
export default function GalleryWallet() {
  const [account, setAccount] = useState('')
  const [chain, setChain] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const p = provider()
    if (!p) return
    const reset = () => { setAccount(''); setChain(''); setMessage('Wallet changed. Reconnect to continue.') }
    p.on?.('accountsChanged', reset)
    p.on?.('chainChanged', reset)
    p.on?.('disconnect', reset)
    return () => {
      p.removeListener?.('accountsChanged', reset)
      p.removeListener?.('chainChanged', reset)
      p.removeListener?.('disconnect', reset)
    }
  }, [])
  async function connect() {
    const p = provider()
    if (!p) { setMessage('No compatible browser wallet detected. You can still browse and shop without one.'); return }
    setBusy(true); setMessage(''); setAccount(''); setChain('')
    try {
      const accounts = await p.request({ method: 'eth_requestAccounts' })
      const network = await p.request({ method: 'eth_chainId' })
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !/^0x[0-9a-f]{40}$/i.test(accounts[0]) || typeof network !== 'string') throw new Error('Invalid wallet response')
      setAccount(accounts[0]); setChain(network.toLowerCase())
    } catch { setMessage('Wallet connection was not completed. No transaction was requested.') }
    finally { setBusy(false) }
  }
  const networks: Record<string,string> = {'0x1':'Ethereum','0x89':'Polygon','0x2105':'Base'}
  return (
    <section aria-labelledby="collector-wallet-heading" className="rounded-xl border border-border bg-card p-6 mt-6">
      <h2 id="collector-wallet-heading" className="font-heading text-2xl">Collector wallet</h2>
      <p className="text-muted-foreground mt-2">Optional preview: connect a browser wallet to view its address and network. No signatures, payments or minting are requested. Connection does not establish ownership or unlock benefits.</p>
      {account ? <div className="mt-4">
        <p className="break-all text-sm">{account}</p>
        <p className="text-sm text-muted-foreground">{networks[chain] || 'Other network — not currently supported for planned collector features'}</p>
        <button type="button" className="underline mt-3" onClick={() => {setAccount('');setChain('');setMessage('Local connection cleared. Manage site permissions in your wallet.')}}>Clear connection</button>
      </div> : <button type="button" disabled={busy} onClick={connect} className="mt-4 rounded-lg bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">{busy ? 'Connecting…' : 'Connect wallet'}</button>}
      <p role="status" className="text-sm text-muted-foreground mt-2">{message}</p>
    </section>
  )
}
