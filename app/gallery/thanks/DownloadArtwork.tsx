'use client'
import {useState} from 'react'
export default function DownloadArtwork({orderId}:{orderId:string}) {
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 async function download(){
  if(busy)return
  setBusy(true);setError('')
  try{
   const response=await fetch('/api/gallery/download?order='+encodeURIComponent(orderId),{cache:'no-store'})
   if(!response.ok)throw Error('Download unavailable')
   const data=await response.json()
   const url=new URL(data.url)
   if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)))throw Error('Invalid download')
   window.location.assign(url.href)
  }catch{setError('Your download is unavailable right now. Check your order status or contact support.')}
  finally{setBusy(false)}
 }
 return <div className="mb-6"><button type="button" disabled={busy} onClick={download} className="rounded-lg border border-primary px-4 py-3">{busy?'Preparing download…':'Download artwork'}</button>{error&&<p role="alert" className="mt-2 text-sm">{error}</p>}</div>
}
