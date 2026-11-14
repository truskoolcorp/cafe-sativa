'use client'
import {useState} from 'react'
import {qaHeldMessage} from '@/lib/content/character-production-qa-diagnostics'
export default function OriginalQaBridge(){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('')
 async function copy(){setBusy(true);try{const r=await fetch('/api/admin/character-promotions/original-qa-bridge',{method:'POST',cache:'no-store'});const v=await r.json();setStatus(r.ok&&v.status==='ingested'?'Existing Zaria output is in a new unapproved QA draft. No video was generated, approved, scheduled or published.':qaHeldMessage(v.diagnostic))}catch{setStatus('Outcome unconfirmed. Check the QA draft before another action.')}finally{setBusy(false)}}
 return <main className="p-6 max-w-2xl"><h1>Review the existing Zaria Gallery output</h1><p>This copies the already-generated, verified original video into a new private QA draft. It does not change existing posts or plans and does not approve or publish anything.</p><button disabled={busy} onClick={copy}>{busy?'Checking and copying…':'Prepare existing video for QA'}</button><p role="status">{status}</p><a href="/admin/character-promotions">Open promotion review</a></main>
}
