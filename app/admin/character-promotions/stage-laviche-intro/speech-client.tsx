'use client'
import {useEffect,useRef,useState} from 'react'

const endpoint='/api/admin/character-promotions/stage-laviche-intro'
const key='cafe-finite-speech-click:stage-ahnika-laviche-intro-v1'

export default function StageLavicheSpeechClient({expiresAt}:{expiresAt:number}){
 const submitted=useRef(true),busy=useRef(false)
 const [used,setUsed]=useState(true),[ready,setReady]=useState(false),[checking,setChecking]=useState(false)
 const [status,setStatus]=useState('Run the read-only check before requesting a take.')
 useEffect(()=>{try{submitted.current=sessionStorage.getItem(key)!==null;setUsed(submitted.current)}catch{setStatus('Browser storage is unavailable. No take can be requested.')}},[])
 async function check(){
  if(busy.current)return
  busy.current=true;setChecking(true);setReady(false)
  try{
   const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)})
   const result=await r.json()
   setReady(r.ok&&result.status==='read_only_preflight'&&result.storagePolicyVerified===true&&result.includedQuotaReady===true&&result.pinnedRevisionMatches===true&&result.scopeActive===true&&result.armed===true)
   setStatus(JSON.stringify(result,null,2))
  }catch{setStatus('Read-only check unavailable. No take requested.')}
  finally{busy.current=false;setChecking(false)}
 }
 async function render(){
  if(submitted.current||busy.current||!ready||Date.now()>=expiresAt)return
  try{sessionStorage.setItem(key,'requested')}catch{setReady(false);setStatus('Browser storage is unavailable. No take requested.');return}
  submitted.current=true;setUsed(true);setReady(false)
  setStatus('One private take requested. Do not refresh or retry.')
  try{
   const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(95000)})
   setStatus(r.ok?'Private take recorded. Listen below before using it.':'Not confirmed. Check the existing claim and private recording; do not retry.')
  }catch{setStatus('Not confirmed. Check the existing claim and private recording; do not retry.')}
 }
 return <section className="space-y-2">
  <button type="button" onClick={()=>void check()} disabled={checking} className="border p-2">Check recording readiness</button>
  <button type="button" onClick={()=>void render()} disabled={!ready||used||Date.now()>=expiresAt} className="border p-2 ml-2">Record one private take</button>
  <pre role="status" className="whitespace-pre-wrap break-all">{status}</pre>
 </section>
}
