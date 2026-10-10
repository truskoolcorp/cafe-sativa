'use client'
import { useCallback, useEffect, useState } from 'react'
import styles from './dashboard.module.css'

type Item = {id:string; title:string; site_category:string; status:string; copy_draft:string; copy_final:string|null; updated_at:string; scheduled_at:string|null; published_at:string|null; approval_notes:string|null; media_url:string|null}
const PROGRAM_DETAILS: Record<string,{host:string;format:string;reference:string}> = {
  stage:{host:'Ahnika Merlot / Laviche',format:'Three-minute open mic, music and Comedy Night Open Floor.',reference:'Approved Stage layout plus the exact image and voice reference for each appearing host.'},
  kitchen:{host:'Featured chefs / approved After Dark cast',format:'Featured-chef programming and MUKBANG After Dark formats.',reference:'Approved Kitchen layout, chef/cast identities and the actual recipe or episode brief.'},
  cigar_lounge:{host:'Laviche',format:'Blind tastings, guided pairings and VIP Craft Roundtable.',reference:'Approved Cigar Lounge layout, Laviche identity and verified product/session details.'},
  bar:{host:'Venue-only preview',format:'Approved virtual bar concept preview; future physical venue planned for 2027.',reference:'The empty-room bar pilot is approved. A host appearance requires separate character references.'},
  gallery:{host:'THE Verse Alkemist — official Media Curator',format:'Art and curator features; exhibition dates remain unconfirmed.',reference:'Approved Gallery layout and the actual artwork, artist attribution and usage permission.'},
  community:{host:'Keith Ingram with Laviche',format:'At the Table: a 90-minute long-table conversation.',reference:'Approved long-table setting and both character identities. A new session needs a confirmed brief/date.'},
}
function cover(category:string) {
  return category==='bar' ? 'https://nwfxvhqbjtfvoopcadff.supabase.co/storage/v1/object/public/cafe-sativa-canon/bar-pilot-2026-10-07.png' : `/rooms/${category}.webp`
}
function ProgramDetails({item}:{item:Item}) {
  const info=PROGRAM_DETAILS[item.site_category]
  return <details className={styles.programDetails}><summary title="Show hosts, format, reference requirements and publication timing">ⓘ Program details</summary>
    <p><strong>Hosts / assignment:</strong> {info?.host || 'To be confirmed'}</p>
    <p><strong>Format:</strong> {info?.format || item.title}</p>
    <p><strong>Required references:</strong> {info?.reference}</p>
    <p><strong>Publication:</strong> {item.published_at ? new Date(item.published_at).toLocaleString() : item.scheduled_at ? `${new Date(item.scheduled_at).toLocaleString()} — approval required before release` : 'Not scheduled'}</p>
    <p>Cover images illustrate the category. A cover does not approve its room geometry or any character for generation.</p>
  </details>
}
type ReferenceStatus={category:string;referenceChecksPassed:boolean;missing:string[];episodeChecks:string[];productionStatus:string}
function ReferenceChecks({status,onReview}:{status?:ReferenceStatus;onReview:()=>void}) {
 return <div style={{borderTop:'1px solid #594635',paddingTop:12,marginTop:12}}><p><strong>{status?(status.referenceChecksPassed?'Reference checks passed':'Media preparation needs review'):'Reference checks unavailable'}</strong></p>{status && <><ul>{status.missing.map(text=><li key={text}>{text}</li>)}</ul><details className={styles.programDetails}><summary>Episode preparation checklist</summary><ul>{status.episodeChecks.map(text=><li key={text}>{text}</li>)}</ul><p>{status.productionStatus}</p><p>Passing reference checks does not approve an episode, announce a guest booking or start paid generation.</p></details></>}<button className={styles.secondary} onClick={onReview}>Review room and character references →</button></div>
}
export default function SiteContentPanel({onReviewReferences}:{onReviewReferences:()=>void}) {
  const [readiness,setReadiness]=useState<ReferenceStatus[]>([])
  const [items,setItems]=useState<Item[]>([])
  const [selected,setSelected]=useState<Item|null>(null)
  const [copy,setCopy]=useState('')
  const [schedule,setSchedule]=useState('')
  const [confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const load=useCallback(async()=>{
    const [response,referenceResponse]=await Promise.all([fetch('/api/content/site',{cache:'no-store'}),fetch('/api/content/references',{cache:'no-store'})])
    const referenceBody=await referenceResponse.json()
    setReadiness(referenceResponse.ok?referenceBody.programmingReadiness || []:[])
    const body=await response.json()
    if(!response.ok) throw new Error(body.error || 'Unable to load website content')
    setItems(body.items || [])
    return body.items as Item[]
  },[])
  useEffect(()=>{void load().catch(e=>setMessage(e.message))},[load])
  function open(item:Item) {setSelected(item);setCopy(item.copy_draft || '');setSchedule(item.scheduled_at || '');setConfirmed(false);setMessage('')}
  async function act(action:string) {
    setBusy(true);setMessage('Saving…')
    try {
      const response=await fetch('/api/content/site',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:selected?.id,copy,expectedUpdatedAt:selected?.updated_at,scheduledAt:schedule,confirmAccuracy:confirmed})})
      const body=await response.json()
      if(!response.ok) throw new Error(body.error || 'Website action failed')
      const fresh=await load()
      if(selected){const item=fresh.find(i=>i.id===selected.id);if(item){setSelected(item);setSchedule(item.scheduled_at || '')}}
      setConfirmed(false)
      setMessage(action==='approve' ? (body.published ? 'Published to the website. Open the category page to view it.' : 'Approved. The daily publisher will release it when its schedule is due.') : action==='plan' ? `${body.planned} program drafts prepared.` : action==='publish_due' ? `${body.published} due items published.` : action==='return' ? 'Returned for revision.' : 'Draft saved. Approval is required before publication.')
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to save')}
    finally{setBusy(false)}
  }
  const locked=selected && (Boolean(selected.media_url) || ['published','archived','failed'].includes(selected.status))
  return <section aria-label="Website programming">
    <h2>Website programming</h2>
    <p>Program introductions use recovered Café Sativa intentions. Approval here publishes website text when due. Social posts and character media follow their separate review paths.</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'16px 0'}}>
      <button className={styles.primary} disabled={busy} onClick={()=>act('plan')}>Prepare program drafts</button>
      <button className={styles.secondary} disabled={busy} onClick={()=>act('publish_due')}>Publish approved due items</button>
      <button className={styles.secondary} disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>Refresh status</button>
    </div>
    <details className={styles.programDetails}><summary>How references and recurring programming work</summary>
      <p>Approve each master room and character reference once, with its source and version. Future briefs reuse those references; a changed layout, identity or voice requires a new version.</p>
      <p>The daily worker checks registered references, reuses approved media before spending and holds missing-reference jobs. New clips and captions still enter accuracy review.</p>
      <p>Website publishing releases approved items when due. The current planner prepares initial program introductions; recurring episode creation and unattended social delivery are not yet connected.</p>
    </details>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {selected ? <div className={styles.card} style={{padding:24}}>
      <button className={styles.secondary} disabled={busy} onClick={()=>{setSelected(null);setMessage('')}}>← Back to website overview</button>
      <img src={cover(selected.site_category)} alt={`${selected.site_category.replaceAll('_',' ')} concept cover`} className={styles.programCover}/>
      <p>{selected.site_category==='bar'?'Approved bar reference':'Existing site concept image — reference approval pending'}</p>
      <ProgramDetails item={selected}/>
      <ReferenceChecks status={readiness.find(r=>r.category===selected.site_category)} onReview={onReviewReferences}/>
      <h3>{selected.title}</h3><p>{selected.site_category.replaceAll('_',' ')} · {selected.status}</p>
      <label htmlFor="site-copy">Full website copy</label>
      <textarea id="site-copy" className={styles.copyEditor} maxLength={15000} value={copy} disabled={busy || !!locked} onChange={e=>{setCopy(e.target.value);setConfirmed(false)}}/>
      <label htmlFor="site-schedule">Publication time (ISO date with timezone, e.g. 2026-10-19T19:00:00-05:00)</label>
      <input id="site-schedule" style={{display:'block',width:'100%',padding:12,margin:'8px 0',color:'#e8ddd0',background:'#161008'}} value={schedule} disabled={busy || !!locked} onChange={e=>{setSchedule(e.target.value);setConfirmed(false)}}/>
      <p>{selected.approval_notes}</p>{selected.media_url && <p>This item reuses an approved clip and its approved caption. Media changes require a separate review.</p>}
      {!locked && <><label style={{display:'flex',gap:10,padding:'16px 0'}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the program names, hosts, historical dates and future-venue wording for website publication.</label>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        <button className={styles.secondary} disabled={busy || !copy.trim()} onClick={()=>act('save')}>Save edits</button>
        <button className={styles.approve} disabled={busy || !confirmed || !copy.trim()} onClick={()=>act('approve')}>✓ Approve website publication</button>
        <button className={styles.reject} disabled={busy} onClick={()=>act('return')}>Return for revision</button>
      </div></>}
      {selected.published_at && <p>Website published: {new Date(selected.published_at).toLocaleString()}</p>}
      <p><a href={`/events?category=${selected.site_category}#feature-${selected.id}`} target="_blank" rel="noreferrer">Open category page ↗</a></p>
    </div> : <div className={styles.cards}>{items.map(item=><article className={styles.card} key={item.id}><img src={cover(item.site_category)} alt={`${item.site_category.replaceAll('_',' ')} concept cover`} className={styles.programCover} loading="lazy"/><div className={styles.cardBody}><p>{item.site_category.replaceAll('_',' ')} · {item.status}</p><h3>{item.title}</h3><p>{item.copy_draft.slice(0,180)}…</p><ProgramDetails item={item}/><ReferenceChecks status={readiness.find(r=>r.category===item.site_category)} onReview={onReviewReferences}/><button className={styles.primary} onClick={()=>open(item)}>Open draft and review →</button></div></article>)}</div>}
    {!items.length && <p>No website drafts prepared yet.</p>}
  </section>
}
