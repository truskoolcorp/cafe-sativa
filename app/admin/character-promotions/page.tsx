'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
export default function CharacterPromotions() {
 const [data,setData]=useState<any>(null),[error,setError]=useState('')
 useEffect(()=>{fetch('/api/admin/character-promotions',{cache:'no-store'}).then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error);setData(x)}).catch(e=>setError(String(e)))},[])
 return <main className="mx-auto max-w-5xl px-5 pt-28 pb-16">
 <Link href="/admin" className="underline">Back to admin</Link>
 <h1 className="text-3xl font-bold my-6">Character promotion queue</h1>
 <p className="mb-5">Production records and delivery status. Video QA and release approval are separate from script approval.</p>
 {error && <p role="alert">{error}</p>}
 {!data && !error && <p>Loading…</p>}
 {data && <div className="grid gap-4 md:grid-cols-2">{data.promos.map((p:any)=><article className="border rounded-lg p-4" key={p.id}>
 <h2 className="text-xl font-bold">{p.title}</h2><p>{p.character_id} · {p.status}</p>
 <p>Stored media: {p.video_asset_path?'Yes':'Not yet'}</p>
 <p>Voice: {p.voice_approved_at?'Approved':'Pending'} · Video: {p.video_qa_approved_at?'Approved':'Pending'} · Publication: {p.publication_approved_at?'Approved':'Pending'}</p>
 {data.delivery.filter((d:any)=>d.promo_id===p.id).map((d:any,i:number)=><p key={i}>{d.network}: {d.status} · {d.scheduled_at||'No slot'}</p>)}
 </article>)}</div>}
 </main>
}
