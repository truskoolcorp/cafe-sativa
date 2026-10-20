'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
type Recording={id:string;title:string;description:string|null;status:string;release_at:string|null;approved_at:string|null;created_at:string}
export default function VipRecordingInventory(){
 const [items,setItems]=useState<Recording[]>([])
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[bucket,setBucket]=useState(''),[path,setPath]=useState('')
 const [saving,setSaving]=useState(false),[notice,setNotice]=useState('')
 const [checks,setChecks]=useState<{checks:{adminAuthenticated:boolean;unapprovedExcluded:boolean;privatePublishedStorage:boolean};catalog:{total:number;eligible:number;unreleased:number}}|null>(null)
 const [verifyError,setVerifyError]=useState(''),[verifying,setVerifying]=useState(false)
 async function verify(){setVerifying(true);setVerifyError('');try{const r=await fetch('/api/admin/vip-recordings/verify',{cache:'no-store'});const b=await r.json();if(!r.ok)throw Error(b.error||'Verification unavailable');setChecks(b)}catch(e){setChecks(null);setVerifyError(e instanceof Error?e.message:'Verification unavailable')}finally{setVerifying(false)}}
 async function register(){setSaving(true);setNotice('');try{const r=await fetch('/api/admin/vip-recordings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,description,storage_bucket:bucket,storage_path:path})});const b=await r.json();if(!r.ok)throw Error(b.error||'Registration failed');setNotice('Private draft registered. Not approved or published.');setTitle('');setDescription('');setBucket('');setPath('');await reload()}catch(e){setNotice(e instanceof Error?e.message:'Registration failed')}finally{setSaving(false)}}
 async function transition(item:Recording,action:'approve'|'release'){
  const meaning=action==='approve'?'confirm this recording has been reviewed for rights, accuracy, and VIP suitability':'release this previously approved recording to eligible VIP members now'
  if(!window.confirm('Confirm you want to '+meaning+'?'))return
  setSaving(true);setNotice('')
  try{
   const r=await fetch('/api/admin/vip-recordings/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,action,confirmReviewed:true})})
   const data=await r.json();if(!r.ok)throw Error(data.error||'Transition failed')
   setNotice(action==='approve'?'Recording approved; not released.':'Recording released to eligible VIP members.')
   await reload()
  }catch(e){setNotice(e instanceof Error?e.message:'Transition failed')}finally{setSaving(false)}
 }
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
 useEffect(()=>{void reload();void verify()},[])
 return <main className="min-h-screen bg-background pt-28 pb-20 px-5"><div className="max-w-4xl mx-auto">
  <Link href="/admin?view=website" className="text-primary underline">← Website Programming</Link>
  <h1 className="font-heading text-3xl mt-5">VIP recording inventory</h1>
  <p className="mt-3 text-muted-foreground">Private editorial inventory. Video storage locations and playback links are not disclosed here. Register an existing video from private storage as a draft. This page cannot upload files. Approval and release are separate, explicitly confirmed actions.</p>
  <section className="rounded-xl border border-border p-5 mt-6"><h2 className="font-heading text-xl font-semibold">VIP catalog safety checks</h2><p className="text-muted-foreground mt-2">Read-only verification of approvals, release eligibility, and private storage. Real member-session playback testing remains separate.</p><button className="mt-3 rounded border border-border px-4 py-2" disabled={verifying} onClick={()=>void verify()}>{verifying?"Checking…":"Run safety checks"}</button>{verifyError&&<p role="alert" className="mt-3">{verifyError}</p>}{checks&&<div className="mt-4 space-y-2"><p>Published recordings have approvals: {checks.checks.unapprovedExcluded?"Pass":"Needs attention"}</p><p>Published recording storage is private: {checks.checks.privatePublishedStorage?"Pass":"Needs attention"}</p><p>Catalog: {checks.catalog.total} total, {checks.catalog.eligible} release-eligible, {checks.catalog.unreleased} unreleased.</p></div>}</section>
  <div className="rounded-xl border border-border p-5 mt-6 grid gap-3">
   <h2 className="font-heading text-xl font-semibold">Register existing private video</h2>
   <input aria-label="Recording title" className="rounded border p-3 bg-card" placeholder="Recording title" value={title} onChange={e=>setTitle(e.target.value)}/>
   <textarea aria-label="Description" className="rounded border p-3 bg-card" placeholder="Description" value={description} onChange={e=>setDescription(e.target.value)}/>
   <input aria-label="Private storage bucket" className="rounded border p-3 bg-card" placeholder="Private storage bucket" value={bucket} onChange={e=>setBucket(e.target.value)}/>
   <input aria-label="Video storage path" className="rounded border p-3 bg-card" placeholder="Video storage path" value={path} onChange={e=>setPath(e.target.value)}/>
   <button className="rounded border border-border px-4 py-2" disabled={saving||!title||!bucket||!path} onClick={()=>void register()}>{saving?'Validating…':'Register private draft'}</button>
   {notice&&<p role="status">{notice}</p>}
  </div>
  <button className="mt-6 rounded border border-border px-4 py-2" onClick={()=>void reload()}>Refresh inventory</button>
  {loading&&<p className="mt-5" role="status">Loading recordings…</p>}
  {error&&<p className="mt-5" role="alert">{error}</p>}
  {!loading&&!error&&!items.length&&<p className="mt-6 rounded-xl border border-border p-5">No recordings have been added to the VIP catalog.</p>}
  <div className="mt-6 space-y-4">{items.map(item=><article className="rounded-xl border border-border p-5" key={item.id}>
   <h2 className="font-heading text-xl font-semibold">{item.title}</h2>
   <p className="mt-2 text-sm">Status: {item.status} · Approval: {item.approved_at?new Date(item.approved_at).toLocaleDateString():'not approved'} · Release: {item.release_at?new Date(item.release_at).toLocaleDateString():'not scheduled'}</p>
   {item.description&&<p className="mt-3 text-muted-foreground">{item.description}</p>}
   {item.status==='draft'&&<button disabled={saving} className="mt-3 rounded border border-border px-4 py-2" onClick={()=>void transition(item,'approve')}>Review and approve</button>}
   {item.status==='approved'&&<button disabled={saving} className="mt-3 rounded border border-border px-4 py-2" onClick={()=>void transition(item,'release')}>Release to VIP members</button>}
  </article>)}</div>
 </div></main>
}