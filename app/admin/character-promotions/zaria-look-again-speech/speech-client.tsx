'use client'
import {useEffect,useRef,useState} from 'react'
export default function SpeechClient({enabled,expiresAt}:{enabled:boolean;expiresAt:number}){
 const latch=useRef(true),[used,setUsed]=useState(true),[result,setResult]=useState('No speech request made from this page.')
 const key='cafe-finite-speech-click:zaria-look-again-speech-v1'
 useEffect(()=>{try{latch.current=sessionStorage.getItem(key)!==null;setUsed(latch.current)}catch{setResult('Browser storage unavailable; no request will be sent.')}},[])
 async function run(){
  if(latch.current||!enabled||Date.now()>=expiresAt)return
  latch.current=true;setUsed(true)
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),95000)
  try{
   sessionStorage.setItem(key,'requested')
   setResult('Private audio requested once. Do not refresh or retry.')
   const r=await fetch('/api/admin/character-promotions/zaria-look-again-speech',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal})
   setResult(JSON.stringify({httpStatus:r.status,result:await r.json()},null,2))
  }catch{setResult('Unconfirmed. Do not retry or change the operation key. Reconcile existing claim and receipt read-only.')}
  finally{clearTimeout(timer)}
 }
 return <section><button type="button" disabled={!enabled||used} onClick={()=>void run()} className="border p-3 my-4">Create this private Zaria audio once</button><pre role="status" aria-live="polite" className="whitespace-pre-wrap break-all">{result}</pre></section>
}
