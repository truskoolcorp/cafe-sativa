'use client'
import { useEffect,useState } from 'react'
import styles from './dashboard.module.css'
export default function SocialConnectionPanel() {
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('Checking social connection…'),[receipts,setReceipts]=useState<any[]>([])
  async function load() {
    const response=await fetch('/api/content/social/status',{cache:'no-store'}),body=await response.json()
    if(!response.ok)throw Error(body.error)
    setConnected(body.connected);setReceipts(body.receipts || [])
    setMessage(body.connected?`${body.brand}: ${body.automaticDispatchEnabled?'approved delivery is enabled':body.deliveryConfigured?'delivery is configured; run the read-only test':'automatic delivery is disabled'}. ${body.lastError || ''}`:'A dedicated Metricool authorization is needed for the website operator. Existing queued posts are unaffected.')
  }
  useEffect(()=>{void load().catch(()=>setMessage('Sign in as a content administrator to check the connection.'))},[])
  async function test() {
    setBusy(true);setMessage('Testing token refresh and delivery tool schemas; no posts are sent…')
    try {const response=await fetch('/api/content/social/test',{method:'POST'}),body=await response.json();if(!response.ok)throw Error(body.error);await load();setMessage(`Connection and delivery tools verified for ${body.brand}. This test sent no posts.`)}catch(error){setMessage(error instanceof Error?error.message:'Connection test failed')}finally{setBusy(false)}
  }
  async function connect() {
    setBusy(true);setMessage('Opening Metricool authorization…')
    try {
      const response=await fetch('/api/content/social/connect',{method:'POST'})
      const body=await response.json()
      if(!response.ok)throw Error(body.error || 'Unable to connect')
      const url=new URL(body.url)
      if(url.origin!=='https://app.metricool.com' || url.pathname!=='/oauth/authorize')throw Error('Invalid authorization destination')
      window.location.assign(url.toString())
    }catch(error){setMessage(error instanceof Error?error.message:'Connection failed');setBusy(false)}
  }
  return <aside className={styles.card} style={{padding:20,margin:'16px 0'}}><h3>Social delivery connection</h3><p role="status">{message}</p><p>Tru Skool Facebook and Threads are the approved marketing destinations. Dallasite on Tour TikTok is excluded. Only approved clip cards with the social-delivery checkbox selected enter the queue.</p><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button className={styles.primary} disabled={busy} onClick={connect}>{connected?'Reconnect Metricool':'Connect Metricool for website automation →'}</button>{connected && <button className={styles.secondary} disabled={busy} onClick={test}>Test connection — sends no posts</button>}<button className={styles.secondary} disabled={busy} onClick={()=>void load().catch(error=>setMessage(error.message))}>Refresh delivery receipts</button></div>{receipts.map(row=><details className={styles.programDetails} key={row.id}><summary>{new Date(row.scheduled_at).toLocaleString()} · {row.state.replaceAll('_',' ')}</summary><p>{row.error || row.receipt?.observation || 'Awaiting dispatch'}</p>{row.provider_uuid && <a href={`https://app.metricool.com/planner/calendar?blogId=5373515&openWithPostUuid=${encodeURIComponent(row.provider_uuid)}`} target="_blank" rel="noreferrer">Open Metricool receipt ↗</a>}<p>A scheduling receipt is not confirmation of publication.</p></details>)}</aside>
}
