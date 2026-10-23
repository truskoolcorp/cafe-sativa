'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
export default function CharacterPromotions() {
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{fetch('/api/admin/character-promotions',{cache:'no-store'}).then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error);setData(x)}).catch(e=>setError(String(e)))},[])
 async function upload(id:string,file:File) {
  setBusy(true);setError('');setMessage('')
  try {
    if(!file.name.toLowerCase().endsWith('.mp4')||file.size>90*1024*1024||file.size<1024)throw new Error('Choose an MP4 between 1 KB and 90 MB')
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer())
    const sha256=Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('')
    const request=async(stage:'init'|'complete')=>{
      const r=await fetch('/api/admin/character-promotions/media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({promoId:id,sha256,size:file.size,stage})})
      const result=await r.json()
      if(!r.ok)throw new Error(result.error || 'Upload failed')
      return result
    }
    setMessage('Preparing secure media transfer…')
    const permission=await request('init')
    setMessage('Uploading verified MP4 directly to protected storage…')
    const stored=await createClient().storage.from('cafe-sativa-content').uploadToSignedUrl(permission.path,permission.token,file,{contentType:'video/mp4'})
    if(stored.error)throw new Error(stored.error.message)
    setMessage('Verifying uploaded bytes and updating the original campaign record…')
    await request('complete')
    setMessage('File verified and attached (SHA-256: '+sha256+'). Final QA and publication approval remain pending.')
    const next=await fetch('/api/admin/character-promotions',{cache:'no-store'});if(next.ok)setData(await next.json())
  }catch(e){setError(e instanceof Error?e.message:'Upload failed')}
  finally{setBusy(false)}
 }
 return <main className="mx-auto max-w-5xl px-5 pt-28 pb-16">
 <Link href="/admin" className="underline">Back to admin</Link>
 <h1 className="text-3xl font-bold my-6">Character promotion queue</h1>
 <p className="mb-5">Production records and delivery status. Video QA and release approval are separate from script approval.</p>
 {error && <p role="alert">{error}</p>}
 {message && <p role="status">{message}</p>}
 {!data && !error && <p>Loading…</p>}
 {data && <div className="grid gap-4 md:grid-cols-2">{data.promos.map((p:any)=><article className="border rounded-lg p-4" key={p.id}>
 <h2 className="text-xl font-bold">{p.title}</h2><p>{p.character_id} · {p.status}</p>
 <p>Stored media: {p.video_asset_path?'Yes':'Not yet'}</p>
 {['andromeda-zouganelis','aurelio'].includes(p.character_id) && <label className="block my-3">Attach final MP4 (max 90 MB; resets video/publication QA)<input type="file" accept="video/mp4,.mp4" disabled={busy} className="block mt-2" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(p.id,file)}}/></label>}
 <p>File-matched QA checks: {data.qa.filter((q:any)=>q.promo_id===p.id && p.video_asset_path?.includes(q.video_sha256+'.mp4') && q.result==='pass').length}/3</p>
 {data.qa.some((q:any)=>q.promo_id===p.id && !p.video_asset_path?.includes(q.video_sha256+'.mp4')) && <p className="text-amber-400">Historical QA belongs to an older video; replacement needs fresh review.</p>}
 <p>Voice: {p.voice_approved_at?'Approved':'Pending'} · Video: {p.video_qa_approved_at?'Approved':'Pending'} · Publication: {p.publication_approved_at?'Approved':'Pending'}</p>
 {data.delivery.filter((d:any)=>d.promo_id===p.id).map((d:any,i:number)=><p key={i}>{d.network}: {d.status} · {d.scheduled_at||'No slot'}</p>)}
 </article>)}</div>}
 </main>
}
