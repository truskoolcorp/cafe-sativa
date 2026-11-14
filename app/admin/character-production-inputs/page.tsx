'use client'
import {useState} from 'react'
export default function Page(){const [status,setStatus]=useState<unknown>(null),[busy,setBusy]=useState(false)
 async function upload(kind:'audio'|'image',file:File|undefined){if(!file||busy)return;setBusy(true);try{const r=await fetch('/api/admin/character-promotions/canary-input',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-input-kind':kind},body:file});setStatus(await r.json())}catch{setStatus({error:'Unconfirmed; inspect before retry'})}finally{setBusy(false)}}
 return <main className="p-8"><h1>Private canary inputs</h1><p>Only the exact reviewed Zaria Gallery image and existing Bree audio are accepted. No generation or publication.</p><label>Existing Bree audio<input disabled={busy} type="file" accept="audio/mpeg" onChange={e=>upload('audio',e.target.files?.[0])}/></label><label>Approved Zaria Gallery image<input disabled={busy} type="file" accept="image/png" onChange={e=>upload('image',e.target.files?.[0])}/></label><pre>{JSON.stringify(status,null,2)}</pre></main>
}
