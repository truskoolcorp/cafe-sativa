'use client'
import { useEffect,useState } from 'react'
import Link from 'next/link'

type Replay={id:string;title:string;description:string|null;release_at:string}
export default function VIPReplaysPage(){
 const [items,setItems]=useState<Replay[]>([])
 const [entitled,setEntitled]=useState<boolean|null>(null)
 const [message,setMessage]=useState('Checking your membership and approved recordings…')
 const [playing,setPlaying]=useState<string|null>(null)
 const [url,setUrl]=useState<string|null>(null)
 useEffect(()=>{let active=true;fetch('/api/account/replays',{cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error||'Unable to load recordings');if(!active)return;setEntitled(body.entitled);setItems(body.items||[]);setMessage('')}).catch(e=>{if(active)setMessage(e instanceof Error?e.message:'Replay library unavailable')});return()=>{active=false}},[])
 async function play(id:string){setUrl(null);setPlaying(id);setMessage('Checking replay access…');try{const r=await fetch('/api/account/replays?play='+encodeURIComponent(id),{cache:'no-store'});const body=await r.json();if(!r.ok)throw Error(body.error||'Replay unavailable');setUrl(body.url);setMessage('Playback link is temporary; reopen this replay if it expires.')}catch(e){setMessage(e instanceof Error?e.message:'Replay unavailable')}}
 return <main className="min-h-screen bg-background pt-24 pb-16"><div className="max-w-4xl mx-auto px-4">
  <p className="text-xs uppercase tracking-widest text-primary font-semibold">Your Café Sativa</p><h1 className="font-heading text-4xl font-bold mt-3">VIP past recordings</h1>
  <p className="mt-3 text-muted-foreground">Watch released recordings included with an active VIP membership. Unapproved or unreleased sessions are never listed.</p>
  <Link href="/account" className="inline-block mt-5 text-primary underline">← Your Dashboard</Link>
  {message && <p role="status" className="mt-6 text-sm text-muted-foreground">{message}</p>}
  {entitled===false && <p className="mt-6 rounded-xl border border-border p-6">VIP access is required for this library. <Link href="/membership" className="text-primary underline">View membership options</Link>.</p>}
  {entitled===true && !items.length && <p className="mt-6 rounded-xl border border-border p-6">Our first live-event recordings are still ahead. When a Café Sativa event is recorded, reviewed, and approved for VIP release, you will find it here. Your membership access is recognized.</p>}
  {entitled===true && items.length>0 && <div className="mt-6 space-y-4">{items.map(item=><article key={item.id} className="rounded-xl border border-border bg-card p-5"><h2 className="font-heading text-xl font-bold">{item.title}</h2>{item.description&&<p className="mt-2 text-sm text-muted-foreground">{item.description}</p>}<p className="mt-2 text-xs text-muted-foreground">Released {new Date(item.release_at).toLocaleDateString()}</p><button className="mt-3 text-primary underline" onClick={()=>void play(item.id)}>Watch recording</button>{playing===item.id && url && <video key={url} className="w-full mt-4 rounded-lg" controls preload="metadata" src={url}/>}</article>)}</div>}
 </div></main>
}
