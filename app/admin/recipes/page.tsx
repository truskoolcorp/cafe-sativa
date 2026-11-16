'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
type Recipe={id:string;title:string;status:string;created_at:string}
export default function RecipeAdmin(){
 const [items,setItems]=useState<Recipe[]>([])
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[details,setDetails]=useState(''),[url,setUrl]=useState('')
 const [reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 async function refresh(){
  const r=await fetch('/api/admin/recipes',{cache:'no-store'});const j=await r.json()
  if(!r.ok)throw Error(j.error||'Unable to load');setItems(j.items||[])
 }
 useEffect(()=>{refresh().catch(e=>setNotice(e.message))},[])
 async function save(action:'draft'|'publish'){
  setBusy(true);setNotice('')
  try{
   const r=await fetch('/api/admin/recipes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,title,description,details,external_url:url,confirmReviewed:reviewed})})
   const j=await r.json();if(!r.ok)throw Error(j.error||'Unable to save')
   setNotice(action==='publish'?'Recipe published.':'Draft saved privately.')
   setTitle('');setDescription('');setDetails('');setUrl('');setReviewed(false);await refresh()
  }catch(e){setNotice(e instanceof Error?e.message:'Save failed')}finally{setBusy(false)}
 }
 return <main className="min-h-screen bg-background px-5 pt-28 pb-20"><div className="mx-auto max-w-3xl">
 <Link href="/admin?view=website" className="text-primary underline">← Website Programming</Link>
 <h1 className="font-heading text-3xl mt-5">Recipe editorial desk</h1><p className="text-muted-foreground mt-2">Save privately as a draft, or publish only after checking the ingredients, instructions, and rights. New entries never publish automatically.</p>
 <div className="grid gap-4 mt-8"><label>Recipe title<input className="w-full border rounded p-3 bg-card block mt-1" value={title} maxLength={240} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Short description<textarea className="w-full border rounded p-3 bg-card block mt-1" value={description} onChange={e=>setDescription(e.target.value)} rows={3}/></label>
 <label>Ingredients and preparation steps<textarea className="w-full border rounded p-3 bg-card block mt-1" value={details} onChange={e=>setDetails(e.target.value)} rows={10}/></label>
 <label>Optional source/reference URL (HTTPS)<input className="w-full border rounded p-3 bg-card block mt-1" value={url} onChange={e=>setUrl(e.target.value)}/></label>
 <label className="flex gap-2 items-start"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>I checked this recipe for accuracy, publication rights, and the Café Sativa editorial standard.</span></label>
 <div className="flex gap-3"><button className="border rounded px-5 py-3" disabled={busy} onClick={()=>void save('draft')}>Save private draft</button><button className="border rounded px-5 py-3" disabled={busy||!reviewed} onClick={()=>void save('publish')}>Publish reviewed recipe</button></div>
 {notice&&<p role="status">{notice}</p>}</div>
 <h2 className="text-xl font-semibold mt-10">Existing recipe entries</h2>{!items.length&&<p className="text-muted-foreground mt-2">No recipes saved yet.</p>}
 <ul className="mt-3 space-y-2">{items.map(x=><li className="border rounded p-3" key={x.id}>{x.title} — {x.status}</li>)}</ul>
 </div></main>
}