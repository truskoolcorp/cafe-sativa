'use client'
import {useEffect,useRef,useState} from 'react'
import {createOneShotProbeClick} from '@/lib/content/character-production-speech-probe-ui'
export default function ProbeClient({attemptId,enabled,expiresAt}:{attemptId:string;enabled:boolean;expiresAt:string}){
 const click=useRef<ReturnType<typeof createOneShotProbeClick>|null>(null)
 const [used,setUsed]=useState(true),[result,setResult]=useState('No probe requested from this page.')
 useEffect(()=>{try{click.current=createOneShotProbeClick(attemptId,window.sessionStorage);setUsed(click.current.used())}catch{setResult('Browser storage unavailable. No probe request will be sent.')}},[attemptId])
 async function run(){
  if(!click.current||used||!enabled||Date.now()>=Date.parse(expiresAt))return
  setUsed(true);setResult('Probe requested. Do not refresh or resubmit.')
  try{setResult(JSON.stringify(await click.current.run(),null,2))}
  catch{setResult('Unconfirmed. Do not retry. Reconcile the configured private marker read-only.')}
 }
 return <section>
  <p>Attempt: {attemptId||'Not configured'}</p><p>Expires: {expiresAt||'Not configured'}</p>
  <p>This performs two competing create-only writes to one harmless private JSON marker. No speech, video, publication, credentials or permissions are changed.</p>
  <button type="button" disabled={!enabled||used} onClick={()=>void run()} className="border rounded p-3 my-4">Run configured storage probe once</button>
  <pre role="status" aria-live="polite" className="whitespace-pre-wrap break-all">{result}</pre>
  <p>After any error or uncertain result, use read-only reconciliation. This page never retries.</p>
 </section>
}
