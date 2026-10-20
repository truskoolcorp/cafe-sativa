'use client'
import Link from 'next/link'
import {useEffect,useState} from 'react'
type Item={id:string;kind:'recipe'|'podcast';title:string;description:string|null;details:string|null;external_url:string|null;published_at:string}
export default function LibraryPage(){
 const [kind,setKind]=useState<'recipe'|'podcast'>('recipe')
 const [items,setItems]=useState<Item[]>([])
 const [message,setMessage]=useState('Loading approved content…')
 useEffect(()=>{let current=true;setMessage('Loading approved content…');fetch('/api/library?kind='+kind,{cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error||'Catalog unavailable');if(current){setItems(b.items||[]);setMessage('')}}).catch(e=>{if(current){setItems([]);setMessage(e instanceof Error?e.message:'Unable to load library')}});return()=>{current=false}},[kind])
 return <main className="min-h-screen bg-background pt-24 pb-16"><div className="max-w-5xl mx-auto px-4">
 <p className="text-xs uppercase tracking-widest text-primary font-semibold">Your Café Sativa</p><h1 className="font-heading text-4xl font-bold mt-3">Recipes & listening library</h1>
 <p className="mt-3 text-muted-foreground">Only reviewed and published recipes, episodes, and links are shown here.</p><Link href="/account" className="mt-5 inline-block text-primary underline">← Your Dashboard</Link>
 <div className="flex gap-3 mt-8"><button aria-pressed={kind==='recipe'} className="rounded-lg border border-border px-5 py-3" onClick={()=>setKind('recipe')}>Recipes</button><button aria-pressed={kind==='podcast'} className="rounded-lg border border-border px-5 py-3" onClick={()=>setKind('podcast')}>Podcasts & recommendations</button></div>
 {message&&<p className="mt-6 text-sm text-muted-foreground" role="status">{message}</p>}
 {!message && !items.length && <p className="mt-6 rounded-xl border border-border p-6">No approved {kind==='recipe'?'recipes':'episodes or recommended links'} have been published yet.</p>}
 <div className="mt-6 grid sm:grid-cols-2 gap-4">{items.map(item=><article className="rounded-xl border border-border bg-card p-5" key={item.id}><h2 className="font-heading text-xl font-bold">{item.title}</h2>{item.description&&<p className="text-sm text-muted-foreground mt-2">{item.description}</p>}{item.details&&<p className="whitespace-pre-wrap text-sm mt-4">{item.details}</p>}{item.external_url&&<a href={item.external_url} rel="noopener noreferrer" target="_blank" className="text-primary underline mt-4 inline-block">Open approved resource ↗</a>}</article>)}</div>
 </div></main>
}