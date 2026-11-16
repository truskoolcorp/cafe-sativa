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
 const [buckets,setBuckets]=useState<Array<{id:string;name:string}>>([])
 const [bucketError,setBucketError]=useState('')
 const [folder,setFolder]=useState('')
 const [files,setFiles]=useState<Array<{name:string;path:string}>>([])
 const [folders,setFolders]=useState<Array<{name:string;path:string}>>([])
 const [browseStatus,setBrowseStatus]=useState('')
 const [browsing,setBrowsing]=useState(false)
 const [previewUrl,setPreviewUrl]=useState('')
 const [previewError,setPreviewError]=useState('')
 const [previewing,setPreviewing]=useState(false)
 async function preview(filePath:string){
  setPreviewUrl('');setPreviewError('');setPath(filePath);setPreviewing(true)
  try{
   const query=new URLSearchParams({preview:'1',bucket,path:filePath})
   const r=await fetch('/api/admin/vip-recordings?'+query.toString(),{cache:'no-store'})
   const data=await r.json();if(!r.ok)throw Error(data.error||'Preview unavailable')
   setPreviewUrl(data.url)
  }catch(e){setPreviewError(e instanceof Error?e.message:'Preview unavailable')}
  finally{setPreviewing(false)}
 }
 async function browse(bucketId:string,dir=''){
  setFiles([]);setFolders([]);setBrowseStatus('');setPreviewUrl('');setPreviewError('')
  if(!bucketId){setFolder('');return}
  setBrowsing(true)
  try{
   const query=new URLSearchParams({files:'1',bucket:bucketId,folder:dir})
   const r=await fetch('/api/admin/vip-recordings?'+query.toString(),{cache:'no-store'})
   const data=await r.json()
   if(!r.ok)throw Error(data.error||'Storage listing failed')
   setFolder(dir);setFiles(data.files||[]);setFolders(data.folders||[])
   if(data.truncated)setBrowseStatus('Showing the first 100 entries. Narrow the folder to see more.')
  }catch(e){setBrowseStatus(e instanceof Error?e.message:'Storage browsing unavailable')}
  finally{setBrowsing(false)}
 }

 async function loadBuckets(){try{const r=await fetch('/api/admin/vip-recordings?buckets=1',{cache:'no-store'});const b=await r.json();if(!r.ok)throw Error(b.error||'Cannot list private buckets');setBuckets(b.buckets||[]);setBucketError('')}catch(e){setBucketError(e instanceof Error?e.message:'Cannot list private buckets')}}
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
 useEffect(()=>{void reload();void verify();void loadBuckets()},[])
 return <main className="min-h-screen bg-background pt-28 pb-20 px-5"><div className="max-w-4xl mx-auto">
  <Link href="/admin?view=website" className="text-primary underline">← Website Programming</Link>
  <h1 className="font-heading text-3xl mt-5">VIP recording inventory</h1>
  <p className="mt-3 text-muted-foreground">Private editorial inventory. Video storage locations and playback links are not disclosed here. Register an existing video from private storage as a draft. This page cannot upload files. Approval and release are separate, explicitly confirmed actions.</p>
  <section className="rounded-xl border border-border p-5 mt-6"><h2 className="font-heading text-xl font-semibold">VIP catalog safety checks</h2><p className="text-muted-foreground mt-2">Read-only verification of approvals, release eligibility, and private storage. Real member-session playback testing remains separate.</p><button className="mt-3 rounded border border-border px-4 py-2" disabled={verifying} onClick={()=>void verify()}>{verifying?"Checking…":"Run safety checks"}</button>{verifyError&&<p role="alert" className="mt-3">{verifyError}</p>}{checks&&<div className="mt-4 space-y-2"><p>Published recordings have approvals: {checks.checks.unapprovedExcluded?"Pass":"Needs attention"}</p><p>Published recording storage is private: {checks.checks.privatePublishedStorage?"Pass":"Needs attention"}</p><p>Catalog: {checks.catalog.total} total, {checks.catalog.eligible} release-eligible, {checks.catalog.unreleased} unreleased. {checks.catalog.total===0?"No recording exists yet; these checks do not certify real playback.":""}</p></div>}</section>
  <div className="rounded-xl border border-border p-5 mt-6 grid gap-3">
   <h2 className="font-heading text-xl font-semibold">Register existing private video</h2>
   <input aria-label="Recording title" className="rounded border p-3 bg-card" placeholder="Recording title" value={title} onChange={e=>setTitle(e.target.value)}/>
   <textarea aria-label="Description" className="rounded border p-3 bg-card" placeholder="Description" value={description} onChange={e=>setDescription(e.target.value)}/>
   <label>Private storage bucket<select aria-label="Private storage bucket" className="rounded border p-3 bg-card w-full mt-1" value={bucket} onChange={e=>{setBucket(e.target.value);setPath('');setPreviewUrl('');void browse(e.target.value)}}><option value="">Select a private bucket</option>{buckets.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{bucketError&&<p role="alert">{bucketError}</p>}{!bucketError&&buckets.length===0&&<p>No private storage buckets available. Registration is unavailable until one is configured.</p>}
   {bucket&&<div className="rounded border border-border p-3">
    <p className="text-sm mb-2">Private video files {folder}</p>
    {folder&&<button className="rounded border px-3 py-1 mr-2" onClick={()=>void browse(bucket,folder.split('/').slice(0,-1).join('/'))}>Parent folder</button>}
    {folders.map(x=><button key={x.path} className="rounded border px-3 py-1 mr-2 mb-2" onClick={()=>void browse(bucket,x.path)}>Folder: {x.name}</button>)}
    {files.map(x=><button key={x.path} className="rounded border px-3 py-1 mr-2 mb-2" onClick={()=>void preview(x.path)}>{path===x.path?'Reviewing: ':'Preview: '}{x.name}</button>)}
    {previewing&&<p role="status">Preparing secure preview…</p>}
    {previewError&&<p role="alert">{previewError}</p>}
    {previewUrl&&<div className="mt-3 mb-3"><p className="text-sm">Private admin preview. This does not approve or publish the video. Link expires after 60 seconds.</p><video key={previewUrl} src={previewUrl} controls preload="metadata" className="w-full max-w-xl mt-2" /></div>}
    <button className="rounded border px-3 py-1 mb-2" disabled={browsing} onClick={()=>void browse(bucket,folder)}>{browsing?'Checking files…':'Refresh this folder'}</button>
    {browseStatus&&<p role="status">{browseStatus}</p>}
    {!browsing&&!browseStatus&&!files.length&&!folders.length&&<p>No supported video files are listed in this folder. Browse another folder or add an approved file to private storage.</p>}
   </div>}
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