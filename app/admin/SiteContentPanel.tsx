'use client'
import { useCallback, useEffect, useState } from 'react'
import styles from './dashboard.module.css'
import SocialConnectionPanel from './SocialConnectionPanel'

type Item = {cover_url?:string|null;id:string; title:string; site_category:string; status:string; copy_draft:string; copy_final:string|null; updated_at:string; scheduled_at:string|null; published_at:string|null; approval_notes:string|null; media_url:string|null}
const PROGRAM_DETAILS: Record<string,{host:string;format:string;reference:string}> = {
  venue:{host:'Venue-only tours',format:'Approved Main Lounge, Courtyard and Cold Stoned concept previews.',reference:'The exact room master used by this clip. No character appearance or operational menu is implied.'},
  stage:{host:'Ahnika Merlot / Laviche',format:'Three-minute open mic, music and Comedy Night Open Floor.',reference:'Approved Stage layout plus the exact image and voice reference for each appearing host.'},
  kitchen:{host:'Featured chefs / approved After Dark cast',format:'Featured-chef programming and MUKBANG After Dark formats.',reference:'Approved Kitchen layout, chef/cast identities and the actual recipe or episode brief.'},
  cigar_lounge:{host:'Laviche',format:'Blind tastings, guided pairings and VIP Craft Roundtable.',reference:'Approved Cigar Lounge layout, Laviche identity and verified product/session details.'},
  bar:{host:'Venue-only preview',format:'Approved virtual bar concept preview; future physical venue planned for 2027.',reference:'The empty-room bar pilot is approved. A host appearance requires separate character references.'},
  gallery:{host:'THE Verse Alkemist — official Media Curator',format:'Art and curator features; exhibition dates remain unconfirmed.',reference:'Approved Gallery layout and the actual artwork, artist attribution and usage permission.'},
  community:{host:'Keith Ingram with Laviche',format:'At the Table: a 90-minute long-table conversation.',reference:'Approved long-table setting and both character identities. A new session needs a confirmed brief/date.'},
}
function localSchedule(iso:string) {const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';const pad=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function ProgramDetails({item}:{item:Item}) {
  const info=PROGRAM_DETAILS[item.site_category]
  return <details className={styles.programDetails}><summary title="Show hosts, format, reference requirements and publication timing">ⓘ Program details</summary>
    <p><strong>Hosts / assignment:</strong> {info?.host || 'To be confirmed'}</p>
    <p><strong>Format:</strong> {info?.format || item.title}</p>
    <p><strong>Required references:</strong> {info?.reference}</p>
    <p><strong>Publication:</strong> {item.published_at ? new Date(item.published_at).toLocaleString() : item.scheduled_at ? `${new Date(item.scheduled_at).toLocaleString()} — approval required before release` : 'Not scheduled'}</p>
    <p>Cover images illustrate the category. The room cover comes from its approved master. An appearing character still requires its own exact canonical reference.</p>
  </details>
}
type ReferenceStatus={category:string;referenceChecksPassed:boolean;missing:string[];episodeChecks:string[];productionStatus:string}
function ReferenceChecks({status,onReview}:{status?:ReferenceStatus;onReview:()=>void}) {
 return <div style={{borderTop:'1px solid #594635',paddingTop:12,marginTop:12}}><p><strong>{status?(status.referenceChecksPassed?'Reference checks passed':'Media preparation needs review'):'Reference checks unavailable'}</strong></p>{status && <><ul>{status.missing.map(text=><li key={text}>{text}</li>)}</ul><details className={styles.programDetails}><summary>Episode preparation checklist</summary><ul>{status.episodeChecks.map(text=><li key={text}>{text}</li>)}</ul><p>{status.productionStatus}</p><p>Passing reference checks does not approve an episode, announce a guest booking or start paid generation.</p></details></>}<button className={styles.secondary} onClick={onReview}>Review room and character references →</button></div>
}
export default function SiteContentPanel({onReviewReferences}:{onReviewReferences:()=>void}) {
  const [covers,setCovers]=useState<Record<string,string>>({})
  const [readiness,setReadiness]=useState<ReferenceStatus[]>([])
  const [items,setItems]=useState<Item[]>([])
  const [selected,setSelected]=useState<Item|null>(null)
  const [queueFilter,setQueueFilter]=useState<'pending'|'all'>('pending')
  const [copy,setCopy]=useState('')
  const [schedule,setSchedule]=useState('')
  const [confirmed,setConfirmed]=useState(false)
  const [publishSocial,setPublishSocial]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [podcastSyncBusy,setPodcastSyncBusy]=useState(false)
  const [podcastSyncMessage,setPodcastSyncMessage]=useState('')
  const [podcastHistory,setPodcastHistory]=useState<Array<{id:string;state:string;trigger:string;started_at:string;imported:number;existing:number;skipped:number;error_code:string|null}>>([])
  const [historyMessage,setHistoryMessage]=useState('')
  const refreshPodcastHistory=useCallback(async()=>{
    try{
      const response=await fetch('/api/admin/library-sync/status',{cache:'no-store'})
      const body=await response.json()
      if(!response.ok)throw Error(body.error||'History unavailable')
      setPodcastHistory(body.receipts||[])
      setHistoryMessage('')
    }catch(e){setHistoryMessage(e instanceof Error?e.message:'History unavailable')}
  },[])
  useEffect(()=>{void refreshPodcastHistory()},[refreshPodcastHistory])

  const load=useCallback(async()=>{
    const [response,referenceResponse]=await Promise.all([fetch('/api/content/site',{cache:'no-store'}),fetch('/api/content/references',{cache:'no-store'})])
    const referenceBody=await referenceResponse.json()
    setCovers(Object.fromEntries((referenceBody.candidates || []).filter((c:any)=>c.kind==='venue' && c.approved).map((c:any)=>[c.subject,c.approved.url])))
    setReadiness(referenceResponse.ok?referenceBody.programmingReadiness || []:[])
    const body=await response.json()
    if(!response.ok) throw new Error(body.error || 'Unable to load website content')
    setItems(body.items || [])
    return body.items as Item[]
  },[])
  useEffect(()=>{void load().then(rows=>{const id=new URL(window.location.href).searchParams.get('item');const item=rows.find(row=>row.id===id);if(item)open(item)}).catch(e=>setMessage(e.message))},[load])
  function open(item:Item) {setSelected(item);setCopy(item.copy_draft || '');setSchedule(item.scheduled_at || '');setConfirmed(false);setPublishSocial(false);setMessage('')}
  async function act(action:string) {
    setBusy(true);setMessage('Saving…')
    try {
      const response=await fetch('/api/content/site',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:selected?.id,copy,expectedUpdatedAt:selected?.updated_at,scheduledAt:schedule,confirmAccuracy:confirmed,publishSocial:action==='approve' && publishSocial})})
      const body=await response.json()
      if(!response.ok) throw new Error(body.error || 'Website action failed')
      const fresh=await load()
      if(selected){const item=fresh.find(i=>i.id===selected.id);if(action==='approve' && item && item.status!=='pending_approval'){const next=fresh.find(i=>i.status==='pending_approval' && i.id!==selected.id);if(next){open(next)}else{setSelected(null);setQueueFilter('pending')}}else if(item){setSelected(item);setSchedule(item.scheduled_at || '')}}
      setConfirmed(false)
      setPublishSocial(false)
      setMessage(action==='approve' ? (body.published ? 'Approval saved and published. Advanced to next pending item.' : 'Approval saved. Advanced to next pending item; publishing will occur when due.') : action==='plan' ? `${body.planned} program drafts prepared.` : action==='prepare_clips' ? `${body.planned} approved clip drafts prepared. Existing cards and schedules were preserved.` : action==='publish_due' ? `${body.published} due items published.` : action==='return' ? 'Returned for revision.' : 'Draft saved. Approval is required before publication.')
      if(body.socialWarning)setMessage(body.socialWarning)
      else if(body.socialQueued)setMessage(`Website approved. Social delivery status: ${body.socialDeliveryStatus || 'queued'}. Check its receipt in Social delivery connection; publication is not confirmed yet.`)
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to save')}
    finally{setBusy(false)}
  }
  async function syncPodcasts(){
    setPodcastSyncBusy(true);setPodcastSyncMessage('Checking approved public Café Sativa feeds…')
    try {
      const response=await fetch('/api/admin/library-sync',{method:'POST'})
      const body=await response.json()
      if(!response.ok)throw Error(body.error||'Podcast sync failed')
      await refreshPodcastHistory()
      setPodcastSyncMessage(`Podcast sync complete: ${body.imported} imported, ${body.existing} already listed, ${body.skipped} skipped.`)
    }catch(e){setPodcastSyncMessage(e instanceof Error?e.message:'Podcast sync failed')}
    finally{setPodcastSyncBusy(false)}
  }
  const locked=selected && ['published','archived','failed'].includes(selected.status)
  return <section aria-label="Website programming">
    <h2>Website programming</h2>
    <p><a href="/admin/recipes" className={styles.secondary} style={{display:'inline-block',padding:'10px 14px',marginBottom:12}}>Open recipe editorial desk →</a></p>
    <SocialConnectionPanel/>
    <div className={styles.card} style={{padding:16,marginBottom:16}}><h3>Approved podcast library</h3><p>Only public episodes from the two Café Sativa Jellypod shows are imported; private drafts and other shows are excluded. Existing records are preserved.</p><button className={styles.secondary} disabled={podcastSyncBusy} onClick={()=>void syncPodcasts()}>{podcastSyncBusy?"Checking feeds…":"Sync published Café Sativa episodes"}</button>{podcastSyncMessage&&<p role="status">{podcastSyncMessage}</p>}
      <div style={{marginTop:12}}><button className={styles.secondary} onClick={()=>void refreshPodcastHistory()}>Refresh sync history</button>{historyMessage&&<p role="status">{historyMessage}</p>}
      {!historyMessage&&!podcastHistory.length&&<p>No sync runs recorded yet.</p>}
      {podcastHistory.slice(0,5).map(entry=><p key={entry.id}>{new Date(entry.started_at).toLocaleString()} — {entry.trigger}: {entry.state}; {entry.imported} imported, {entry.existing} existing, {entry.skipped} skipped{entry.error_code?' ('+entry.error_code+')':''}</p>)}
      </div></div>
    <p>Program introductions use recovered Café Sativa intentions. Approval here publishes website text when due. Social posts and character media follow their separate review paths.</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'16px 0'}}>
      <button className={styles.primary} disabled={busy} onClick={()=>act('plan')}>Prepare program drafts</button>
      <button className={styles.primary} disabled={busy} onClick={()=>act('prepare_clips')}>Prepare approved clip drafts</button>
      <button className={styles.secondary} disabled={busy} onClick={()=>act('publish_due')}>Publish approved due items</button>
      <button className={styles.secondary} disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>Refresh status</button>
    </div>
    {!selected && <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}><button className={styles.secondary} aria-pressed={queueFilter==='pending'} onClick={()=>setQueueFilter('pending')}>Needs approval ({items.filter(i=>i.status==='pending_approval').length})</button><button className={styles.secondary} aria-pressed={queueFilter==='all'} onClick={()=>setQueueFilter('all')}>All content</button></div>}
    <details className={styles.programDetails}><summary>How references and recurring programming work</summary>
      <p>Approve each master room and character reference once, with its source and version. Future briefs reuse those references; a changed layout, identity or voice requires a new version.</p>
      <p>The worker checks registered references every 15 minutes, reuses approved media before spending and holds missing-reference jobs. New clips and captions still enter accuracy review.</p>
      <p>Approved venue clips automatically receive website review cards after accuracy review. Review their captions and choose release times here. The daily planner also recovers missing cards without replacing your edits. Explicit social-sharing approval schedules the reviewed clip on Tru Skool Facebook and Threads. Character episode creation remains unfinished.</p>
    </details>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {selected ? <div className={styles.card} style={{padding:24}}>
      <button className={styles.secondary} disabled={busy} onClick={()=>{setSelected(null);setMessage('')}}>← Back to website overview</button>
      {(selected.cover_url || covers[selected.site_category]) && <img src={(selected.cover_url || covers[selected.site_category])} alt={`${selected.site_category.replaceAll('_',' ')} concept cover`} className={styles.programCover}/>}
      <p>{(selected.cover_url || covers[selected.site_category])?'Approved canonical room reference':'Approved cover unavailable — review Master references'}</p>
      <ProgramDetails item={selected}/>
      <ReferenceChecks status={readiness.find(r=>r.category===selected.site_category)} onReview={onReviewReferences}/>
      <h3>{selected.title}</h3><p>{selected.site_category.replaceAll('_',' ')} · {selected.status}</p>
      <label htmlFor="site-copy">Full website copy</label>
      <textarea id="site-copy" className={styles.copyEditor} maxLength={15000} value={copy} disabled={busy || !!locked} onChange={e=>{setCopy(e.target.value);setConfirmed(false)}}/>
      <label htmlFor="site-schedule">Publication time (your device's local time)</label>
      <input id="site-schedule" type="datetime-local" style={{display:'block',width:'100%',padding:12,margin:'8px 0',color:'#e8ddd0',background:'#161008'}} value={localSchedule(schedule)} disabled={busy || !!locked} onChange={e=>{setSchedule(e.target.value?new Date(e.target.value).toISOString():'');setConfirmed(false)}}/>
      {schedule && <p>Chicago release: {new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'}).format(new Date(schedule))}</p>}
      <p>{selected.approval_notes}</p>{selected.media_url && <p>This item uses a clip that passed accuracy review. You can review its website caption and release time here. Changing the clip requires a separate accuracy review.</p>}
      {!locked && <><label style={{display:'flex',gap:10,padding:'16px 0'}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the program names, hosts, historical dates and future-venue wording for website publication.</label>
      {selected.media_url && <label style={{display:'flex',gap:10,padding:'16px 0'}}><input type="checkbox" checked={publishSocial} onChange={e=>setPublishSocial(e.target.checked)}/>Also schedule this approved clip and this exact caption on Tru Skool Facebook and Threads at the release time above. Maximum 500 characters; choose a time at least 30 minutes ahead.</label>}
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        <button className={styles.secondary} disabled={busy || !copy.trim()} onClick={()=>act('save')}>Save edits</button>
        <button className={styles.approve} disabled={busy || !confirmed || !copy.trim()} onClick={()=>act('approve')}>✓ Approve website publication</button>
        <button className={styles.reject} disabled={busy} onClick={()=>act('return')}>Return for revision</button>
      </div></>}
      {selected.published_at && <p>Website published: {new Date(selected.published_at).toLocaleString()}</p>}
      <p><a href={selected.site_category==='venue'?`/venue#feature-${selected.id}`:`/events?category=${selected.site_category}#feature-${selected.id}`} target="_blank" rel="noreferrer">Open category page ↗</a></p>
    </div> : <div className={styles.cards}>{items.filter(item=>queueFilter==='all' || item.status==='pending_approval').map(item=><article className={styles.card} key={item.id}>{(item.cover_url || covers[item.site_category]) && <img src={(item.cover_url || covers[item.site_category])} alt={`${item.site_category.replaceAll('_',' ')} concept cover`} className={styles.programCover} loading="lazy"/>}<div className={styles.cardBody}><p>{item.site_category.replaceAll('_',' ')} · {item.status}</p><h3>{item.title}</h3><p>{item.copy_draft.slice(0,180)}…</p><ProgramDetails item={item}/><ReferenceChecks status={readiness.find(r=>r.category===item.site_category)} onReview={onReviewReferences}/><button className={styles.primary} onClick={()=>open(item)}>Open draft and review →</button></div></article>)}</div>}
    {!items.length && <p>No website drafts prepared yet.</p>}
    {!!items.length && !selected && queueFilter==='pending' && !items.some(item=>item.status==='pending_approval') && <p role="status">All caught up — no website items need approval.</p>}
  </section>
}
