'use client'
import {useRef,useState} from 'react'
export default function Recovery(){
 const pending=useRef(false),[status,setStatus]=useState<string|null>(null)
 async function run(){
  if(pending.current)return
  pending.current=true;setStatus('running')
  try{const r=await fetch('/api/admin/character-promotions/private-text-recovery',{method:'POST',credentials:'same-origin',cache:'no-store'});const b=await r.json();setStatus(b.status==='private_text_saved'?'saved':'held')}
  catch{setStatus('held')}
 }
 return <section><button className="rounded border px-4 py-2 disabled:opacity-50" disabled={status!==null} onClick={run}>Recover one private script</button>{status&&<p role="status">{status==='running'?'Running one bounded recovery…':status==='saved'?'Private script saved. Verify its persisted identity before continuing original included-credit speech.':'Recovery held or unconfirmed. Do not repeat; reconcile the existing attempt.'}</p>}</section>
}
