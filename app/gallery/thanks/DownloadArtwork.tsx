'use client'
import {useState} from 'react'
export default function DownloadArtwork({orderId}:{orderId:string}) {
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 async function download(){
  if(busy)return
  setBusy(true);setError('')
  try{
   const response=await fetch('/api/gallery/download?order='+encodeURIComponent(orderId),{cache:'no-store',credentials:'same-origin',redirect:'error'})
   if(!response.ok||response.headers.get('Content-Type')!=='application/octet-stream')throw Error('Download unavailable')
   const filename=response.headers.get('Content-Disposition')==='attachment; filename="cafe-sativa-artwork.png"'?'cafe-sativa-artwork.png':'cafe-sativa-artwork.bin'
   const blob=await response.blob()
   if(blob.size<1||blob.size>50*1024*1024)throw Error('Invalid download')
   const url=URL.createObjectURL(blob)
   const anchor=document.createElement('a')
   anchor.href=url;anchor.download=filename
   try{document.body.appendChild(anchor);anchor.click()}
   finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
  }catch{setError('Your download is unavailable right now. Check your order status or contact support.')}
  finally{setBusy(false)}
 }
 return <div className="mb-6"><button type="button" disabled={busy} onClick={download} className="rounded-lg border border-primary px-4 py-3">{busy?'Preparing download…':'Download artwork'}</button>{error&&<p role="alert" className="mt-2 text-sm">{error}</p>}</div>
}
