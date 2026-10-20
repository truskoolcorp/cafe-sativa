'use client'
import {useEffect,useMemo,useState} from 'react'
import Link from 'next/link'
type Event={id:string;title:string;starts_at:string;status:string;category:string|null;presenter_name:string|null}
type Video={id:string;title:string;room:string;status:string;created_at:string;previewUrl:string|null;blocker:string|null}
type Content={id:string;title:string;channel:string;agent:string;status:string;scheduled_at:string}
type Data={events:Event[];videoJobs:Video[];scheduledContent:Content[];notes:{videoDate:string;character:string;social:string}}
const format=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
export default function Programming(){
 const [month,setMonth]=useState(()=>new Date().toLocaleDateString('sv-SE',{timeZone:'America/Chicago'}).slice(0,7))
 const [scope,setScope]=useState<'month'|'week'>('month')
 const [kind,setKind]=useState<'all'|'event'|'video'|'content'>('all')
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{let active=true;setLoading(true);setError('');fetch('/api/admin/programming?month='+month,{cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error||'Unavailable');if(active)setData(body)}).catch(e=>{if(active){setData(null);setError(e instanceof Error?e.message:'Unavailable')}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[month])
 const rows=useMemo(()=>{const all:{id:string;kind:'event'|'video'|'content';title:string;date:string;status:string;description:string;previewUrl?:string|null}[]=[]
 for(const v of data?.videoJobs||[])all.push({id:v.id,kind:'video',title:v.title,date:v.created_at,status:v.status,description:'Venue: '+v.room+' · job created, not an event booking'+(v.blocker?' · '+v.blocker:''),previewUrl:v.previewUrl})
 for(const e of data?.events||[])all.push({id:e.id,kind:'event',title:e.title,date:e.starts_at,status:e.status,description:[e.category,e.presenter_name].filter(Boolean).join(' · ')||'Event record'})
 for(const c of data?.scheduledContent||[])all.push({id:c.id,kind:'content',title:c.title,date:c.scheduled_at,status:c.status,description:[c.channel,c.agent].filter(Boolean).join(' · ')})
 const today=new Date();const day=today.getUTCDay();const monday=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-(day+6)%7));const sunday=new Date(monday.getTime()+7*86400000)
 return all.filter(r=>(kind==='all'||r.kind===kind)&&(scope==='month'||(new Date(r.date)>=monday&&new Date(r.date)<sunday))).sort((a,b)=>a.date.localeCompare(b.date))
 },[data,kind,scope])
 return <main className="min-h-screen bg-background px-4 pt-24 pb-16"><div className="mx-auto max-w-6xl space-y-6">
 <Link href="/admin?view=calendar" className="text-primary underline">← Content administration</Link><h1 className="font-heading text-3xl font-bold">Programming Calendar</h1>
 <p className="text-muted-foreground">Read-only view of real event records, video-production jobs and website-scheduled content. Drafts are not confirmed events or published posts.</p>
 <div className="flex flex-wrap gap-3 items-center"><label htmlFor="month" className="text-sm">Month</label><input id="month" type="month" value={month} onChange={e=>setMonth(e.target.value)} className="rounded border border-border bg-card p-2 text-foreground"/><button aria-pressed={scope==='month'} onClick={()=>setScope('month')} className="rounded border border-border px-4 py-2">Month</button><button aria-pressed={scope==='week'} onClick={()=>setScope('week')} className="rounded border border-border px-4 py-2">This week</button><label htmlFor="type" className="text-sm">Show</label><select id="type" value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className="rounded border border-border bg-card p-2"><option value="all">Everything</option><option value="event">Events</option><option value="video">Video jobs</option><option value="content">Website scheduled content</option></select></div>
 {loading&&<p role="status">Loading programming…</p>}{error&&<p role="alert">{error}</p>}
 {data&&!loading&&<><div className="grid grid-cols-3 gap-3">{[['Events',data.events.length],['Video jobs',data.videoJobs.length],['Website content',data.scheduledContent.length]].map(([label,count])=><div key={String(label)} className="rounded-lg border border-border bg-card p-4"><strong className="text-2xl">{count}</strong><p className="text-sm text-muted-foreground">{label}</p></div>)}</div>
 <p className="text-sm text-muted-foreground">Video dates are job creation dates; only event start times and scheduled-content dates represent planned occurrences. All displayed times are Dallas time.</p>
 {!rows.length&&<p className="rounded-lg border border-border p-6">No records in this selection. This does not imply that an event or video has been scheduled.</p>}
 <div className="grid gap-4 sm:grid-cols-2">{rows.map(r=><article key={r.kind+r.id} className="rounded-xl border border-border bg-card p-5 space-y-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-xs uppercase tracking-widest text-primary">{r.kind==='video'?'Video job':r.kind==='content'?'Website content':'Event'}</span><span className="text-xs rounded border border-border px-2 py-1">{r.status}</span></div><h2 className="font-heading text-xl font-semibold">{r.title}</h2><p className="text-sm">{format(r.date)} CT</p><p className="text-sm text-muted-foreground">{r.description}</p>{r.previewUrl&&<video controls preload="none" src={r.previewUrl} className="w-full rounded-lg" aria-label={'Preview '+r.title}/>}</article>)}</div>
 <p className="text-sm text-muted-foreground">Metricool-managed social posts and character-specific production assets are not yet part of this combined source view. See the <Link href="/admin?view=calendar" className="underline text-primary">Content Calendar</Link> and <Link href="/admin?view=references" className="underline text-primary">Master References</Link> for their existing workflows.</p></>}
 </div></main>
}
