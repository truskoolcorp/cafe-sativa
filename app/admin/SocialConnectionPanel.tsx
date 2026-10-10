'use client'
import { useEffect,useState } from 'react'
import styles from './dashboard.module.css'
export default function SocialConnectionPanel() {
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('Checking social connection…')
  useEffect(()=>{void fetch('/api/content/social/status',{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error);setConnected(body.connected);setMessage(body.connected?`Authorized: ${body.brand}. Automatic social dispatch is still disabled.`:'A dedicated Metricool authorization is needed for the website operator. Existing queued posts are unaffected.')}).catch(()=>setMessage('Sign in as a content administrator to check the connection.'))},[])
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
  return <aside className={styles.card} style={{padding:20,margin:'16px 0'}}><h3>Social delivery connection</h3><p role="status">{message}</p><p>Tru Skool Facebook and Threads are the approved marketing destinations. Dallasite on Tour TikTok is excluded. This connection sends no posts; dispatch will be verified separately.</p><button className={styles.primary} disabled={busy} onClick={connect}>{connected?'Reconnect Metricool':'Connect Metricool for website automation →'}</button></aside>
}
