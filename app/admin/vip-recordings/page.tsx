'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
type Recording={id:string;title:string;description:string|null;status:string;release_at:string|null;approved_at:string|null;created_at:string}
export default function VipRecordingInventory(){
 const [items,setItems]=useState<Recording[]>([])
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 async function reload(){
  setLoading(true);setError('')
  try{
   const response=await fetch('/api/admin/vip-recordings',{cache:'no-store'})
   const body=await response.json()
   if(!response.ok)throw Error(body.error||'Unable to load inventory')
   setItems(body.recordings||[])
  }catch(e){setError(e instanceof Error?e.message:'Unable to load inventory')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void reload()},[])
 return <main className="min-h-screen bg-background pt-28 pb-20 px-5"><div className="max-w-4xl mx-auto">
  <Link href="/admin?view=website" className="text-primary underline">← Website Programming</Link>
  <h1 className="font-heading text-3xl mt-5">VIP recording inventory</h1>
  <p className="mt-3 text-muted-foreground">Private editorial inventory. Video storage locations and playback links are not disclosed here. This page cannot publish, upload, or modify recordings.</p>
  <button className="mt-6 rounded border border-border px-4 py-2" onClick={()=>void reload()}>Refresh inventory</button>
  {loading&&<p className="mt-5" role="status">Loading recordings…</p>}
  {error&&<p className="mt-5" role="alert">{error}</p>}
  {!loading&&!error&&!items.length&&<p className="mt-6 rounded-xl border border-border p-5">No recordings have been added to the VIP catalog.</p>}
  <div className="mt-6 space-y-4">{items.map(item=><article className="rounded-xl border border-border p-5" key={item.id}>
   <h2 className="font-heading text-xl font-semibold">{item.title}</h2>
   <p className="mt-2 text-sm">Status: {item.status} · Approval: {item.approved_at?new Date(item.approved_at).toLocaleDateString():'not approved'} · Release: {item.release_at?new Date(item.release_at).toLocaleDateString():'not scheduled'}</p>
   {item.description&&<p className="mt-3 text-muted-foreground">{item.description}</p>}
  </article>)}</div>
 </div></main>
}