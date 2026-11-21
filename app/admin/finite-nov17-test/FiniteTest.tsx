'use client'
import {useRef,useState} from 'react'
type State='idle'|'running'|'text_saved'|'audio_saved'|'held'
export default function FiniteTest({enabled}:{enabled:boolean}){
 const pending=useRef(false),[state,setState]=useState<State>('idle')
 async function run(){
  if(!enabled||pending.current||!['idle','text_saved'].includes(state))return
  const prior=state;pending.current=true;setState('running')
  try{
   const r=await fetch('/api/admin/character-promotions/finite-nov17-test',{method:'POST',credentials:'same-origin',cache:'no-store'})
   const body=await r.json()
   if(r.ok&&body.status==='private_text_saved'&&prior==='idle'){setState('text_saved');pending.current=false}
   else if(r.ok&&body.status==='private_audio_saved')setState('audio_saved')
   else setState('held')
  }catch{setState('held')}
 }
 return <section><button className="rounded border px-4 py-2 disabled:opacity-50" disabled={!enabled||!['idle','text_saved'].includes(state)} onClick={run}>{state==='text_saved'?'Create one included-credit audio sample':'Run one authorized private phase'}</button><p role="status" className="my-4">{!enabled?'This test is disabled or outside the November 17 Dallas window.':state==='running'?'Running one bounded phase. Do not repeat.':state==='text_saved'?'Private script and content checkpoint saved. The next button requests one included-credit audio sample.':state==='audio_saved'?'Private audio saved for review. This does not approve publishing.':state==='held'?'Held or unconfirmed. Do not retry or reload to repeat; reconcile the existing attempt.':'No operation runs until you click.'}</p></section>
}
