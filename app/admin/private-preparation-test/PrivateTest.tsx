'use client'
import {useRef,useState} from 'react'
const messages:Record<string,string>={private_text_saved:'The new private script was saved. Continue once to generate its included-credit speech.',private_audio_saved:'The private audio and provider receipt were saved. Editorial and listening review remain pending.',original_private_audio_verified:'The original private audio receipt was verified. Nothing was regenerated.',disabled:'The finite test is disabled or expired. No completion is claimed.',unconfigured:'The private test configuration is not ready. No completion is claimed.',held_original_text:'The original text attempt is held. Do not repeat generation; reconcile its existing receipt.',held_original_speech:'The original speech attempt is held. Do not repeat generation; reconcile its existing receipt.',held_authority:'The private test authority is unavailable. No completion is claimed.'}
export default function PrivateTest(){
 const pending=useRef(false),[busy,setBusy]=useState(false),[status,setStatus]=useState<string|null>(null)
 async function run(){
  if(pending.current)return
  pending.current=true;setBusy(true)
  try{const response=await fetch('/api/admin/character-promotions/private-preparation-test',{method:'POST',credentials:'same-origin',cache:'no-store'});const body=await response.json();setStatus(typeof body.status==='string'?body.status:'unknown')}
  catch{setStatus('unknown')}
  finally{pending.current=false;setBusy(false)}
 }
 const canRun=status===null||status==='private_text_saved'
 return <section><button className="rounded border px-4 py-2 disabled:opacity-50" disabled={busy||!canRun} onClick={run}>{busy?'Checking and running one phase…':status==='private_text_saved'?'Continue to included speech':'Run one private test phase'}</button>{status&&<p role="status" className="mt-4">{messages[status]??'The outcome is unconfirmed. Do not retry; reconcile the existing attempt before continuing.'}</p>}</section>
}
