'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import ContentReview from './content/ContentReview';
import SiteContentPanel from './SiteContentPanel';
import styles from './dashboard.module.css';

// All Airtable calls go through /api/admin/airtable — PAT never exposed client-side
async function atGet(table: string, params = '') {
  const r = await fetch(`/api/admin/airtable?table=${table}&params=${encodeURIComponent(params)}`);
  return r.json();
}

const C = {
  bg: '#0d0a07', surface: '#161008', card: '#1c1409', border: '#2e1f0e',
  accent: '#b8813a', roseGold: '#c9826b', green: '#4caf7d', amber: '#e0a030',
  red: '#c0504a', muted: '#6b5540', text: '#e8ddd0', textDim: '#9e8870',
};
const STATUS: Record<string, { bg: string; text: string; label: string }> = {
  pending_approval: { bg: '#2a1f00', text: C.amber,   label: 'Pending'   },
  approved:         { bg: '#0a2010', text: C.green,   label: 'Approved'  },
  scheduled:        { bg: '#0e1a2a', text: '#5aa0d0', label: 'Scheduled' },
  published:        { bg: '#0a2010', text: C.green,   label: 'Published' },
  failed:           { bg: '#2a0a08', text: C.red,     label: 'Failed'    },
};
const AGENT_COLOR: Record<string, string> = {
  Laviche: C.roseGold, Ginger: '#d4936a', Ahnika: '#9b8dc4',
};
const CH_ICON: Record<string, string> = {
  social_instagram: 'IG', social_tiktok: 'TK', social_x: 'X',
};

function Badge({ status }: { status: string }) {
  const s = STATUS[status] || { bg: '#222', text: '#888', label: status };
  return <span style={{ background: s.bg, color: s.text, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' }}>{s.label}</span>;
}
function Dot({ agent }: { agent: string }) {
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: AGENT_COLOR[agent] || C.muted, marginRight: 5 }} />;
}
function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 11, color: C.textDim, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || C.text, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab]         = useState('calendar');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<any>(null);
  const [draftCopy, setDraftCopy] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [detailMessage, setDetailMessage] = useState('');
  const [current, setCurrent] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [records, setRecords] = useState<any[]>([]);
  const [genLog, setGenLog]   = useState<any[]>([]);
  const [pubLog, setPubLog]   = useState<any[]>([]);
  const [brief, setBrief]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const [filter, setFilter]   = useState('all');

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
    const [cal, gen, pub, br, live] = await Promise.all([
      atGet('calendar',   '?maxRecords=50&sort[0][field]=Title&sort[0][direction]=asc'),
      atGet('genLog',     '?maxRecords=20&sort[0][field]=Run+Date&sort[0][direction]=desc'),
      atGet('publishLog', '?maxRecords=20&sort[0][field]=Published+At&sort[0][direction]=desc'),
      atGet('brief',      '?maxRecords=10&sort[0][field]=Week+Of&sort[0][direction]=desc'),
      fetch('/api/content/review', { cache: 'no-store' }).then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error || 'Unable to load current content'); return b; }),
    ]);
    if ([cal, gen, pub, br].some(r => r.error)) throw new Error('Some historical records could not be loaded. Refresh or sign in again.');
    setCurrent(live);
    setRecords(cal.records || []);
    setGenLog(gen.records  || []);
    setPubLog(pub.records  || []);
    setBrief(br.records    || []);
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Unable to load dashboard'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (detail) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [detail]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden && !detail && !acting) void loadAll(); }, 60000);
    return () => clearInterval(timer);
  }, [detail, acting, loadAll]);
  function openDraft(rec:any) { setDetail({ kind:'draft', record:rec }); setDraftCopy(rec.fields['Copy Draft'] || ''); setConfirmed(false); setDetailMessage(''); }
  async function saveDraft(action:string) {
    setActing(detail.record.id); setDetailMessage('Saving…');
    try {
      const response = await fetch(`/api/admin/airtable?table=calendar&recordId=${detail.record.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, copy:draftCopy, expectedCopy:detail.record.fields['Copy Draft'] || '', confirmAccuracy:confirmed }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save');
      setDetail({ kind:'draft', record:body }); setDraftCopy(body.fields['Copy Draft']); setConfirmed(false);
      setDetailMessage(action==='approve' ? 'Copy approved. Scheduling is still pending; no post was sent by this action.' : action==='return' ? 'Returned for revision.' : 'Draft saved. Review it before approval.');
      await loadAll();
    } catch(e) { setDetailMessage(e instanceof Error ? e.message : 'Unable to save'); }
    finally { setActing(null); }
  }
  const liveJobs = current?.jobs || [];
  const totalPending = records.filter(r=>r.fields.Status==='pending_approval').length + liveJobs.filter((j:any)=>j.status==='pending_qa').length;
  const counts = records.reduce((a: Record<string,number>, r) => { const s = r.fields?.Status || 'unknown'; a[s] = (a[s]||0)+1; return a; }, {});
  const pending  = records.filter(r => r.fields?.Status === 'pending_approval');
  const filtered = tab==='approvals' ? pending : filter === 'all' ? records : records.filter(r => r.fields?.Status === filter);
  const shownJobs = liveJobs.filter((j:any)=>tab==='approvals' ? j.status==='pending_qa' : filter==='all' || (filter==='pending_approval' ? j.status==='pending_qa' : j.status===filter));

  const btn = (label: string, key: string) => (
    <button key={key} onClick={() => setTab(key)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px', fontSize: 12, fontWeight: tab===key ? 700 : 400, color: tab===key ? C.accent : C.textDim, borderBottom: tab===key ? `2px solid ${C.accent}` : '2px solid transparent', letterSpacing: '0.03em' }}>{label}</button>
  );

  return (
    <div className={styles.dashboard} style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", fontSize: 13 }}>
      {toast && <div style={{ position:'fixed', top:16, right:16, zIndex:9999, background: toast.ok?'#0a2010':'#2a0a08', border:`1px solid ${toast.ok?C.green:C.red}`, color:toast.ok?C.green:C.red, padding:'10px 16px', borderRadius:6, fontSize:12, fontWeight:600 }}>{toast.msg}</div>}

      <dialog ref={dialogRef} className={styles.dialog} onCancel={e=>{if(acting){e.preventDefault();return;}setDetail(null);}} onClose={()=>{if(!acting)setDetail(null);}}>
        <button className={styles.secondary} disabled={!!acting} onClick={()=>setDetail(null)}>← Back to overview</button>
        {detail?.kind==='video' && <ContentReview jobId={detail.id} embedded onChanged={()=>void loadAll()}/>}
        {detail?.kind==='draft' && <div style={{padding:20}}>
          <h2>{detail.record.fields.Title}</h2><Badge status={detail.record.fields.Status}/>
          <p>{detail.record.fields.Agent} · {detail.record.fields.Channel}</p>
          <label htmlFor="draft-copy"><strong>Full draft copy</strong></label>
          <textarea id="draft-copy" className={styles.copyEditor} value={draftCopy} maxLength={15000} disabled={!!acting || ['scheduled','published'].includes(detail.record.fields.Status)} onChange={e=>{setDraftCopy(e.target.value);setConfirmed(false);}}/>
          {detail.record.fields['Media URL'] && (/\.(mp4|webm|mov)/i.test(detail.record.fields['Media URL']) ? <video src={detail.record.fields['Media URL']} controls style={{maxWidth:'100%',maxHeight:350}}/> : <img src={detail.record.fields['Media URL']} alt="Draft attachment" style={{maxWidth:'100%',maxHeight:350}}/>)}
          <p><strong>Delivery:</strong> {detail.record.fields['Media URL']?'Media attached; final media approval and channel scheduling still need verification.':'No media attached. Copy approval does not create an image or video.'} No verified scheduler receipt is linked to this draft.</p>
          {!['scheduled','published'].includes(detail.record.fields.Status) && <>
            <label style={{display:'flex',gap:10,padding:'16px 0'}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this copy for current use, including future-venue wording and dates.</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
              <button className={styles.secondary} disabled={!!acting || !draftCopy.trim()} onClick={()=>saveDraft('save')}>Save edits</button>
              <button className={styles.approve} disabled={!!acting || !confirmed || !draftCopy.trim()} onClick={()=>saveDraft('approve')}>✓ Approve copy</button>
              <button className={styles.reject} disabled={!!acting || !draftCopy.trim()} onClick={()=>saveDraft('return')}>Return for revision</button>
            </div>
          </>}
          {detailMessage && <p role="status" className={styles.feedback}>{detailMessage}</p>}
          <details style={{marginTop:20}}><summary>Extended details &amp; activity</summary><dl>{Object.entries(detail.record.fields).filter(([key])=>key!=='Copy Draft').map(([key,value])=><div key={key} style={{marginTop:12}}><dt><strong>{key==='Scheduled At'?'Proposed schedule (unverified)':key}</strong></dt><dd style={{whiteSpace:'pre-wrap',margin:'4px 0',overflowWrap:'anywhere'}}>{typeof value==='string'?value:JSON.stringify(value)}</dd></div>)}</dl></details>
        </div>}
      </dialog>
      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between', height:52, background:C.surface }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:6, background:`linear-gradient(135deg,${C.accent},${C.roseGold})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>🌿</div>
          <span style={{ fontWeight:700, fontSize:14, letterSpacing:'-0.02em' }}>Café Sativa</span>
          <span style={{ color:C.muted, fontSize:12 }}>/ Content Engine</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {pending.length > 0 && <span style={{ background:C.amber, color:'#0d0a07', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10 }}>{totalPending} to review</span>}
          <button onClick={loadAll} style={{ background:'none', border:`1px solid ${C.border}`, color:C.textDim, padding:'5px 12px', borderRadius:5, cursor:'pointer', fontSize:11 }}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ padding:'20px 24px', display:'flex', flexWrap:'wrap', alignItems:'center', gap:12 }}>
        <button className={styles.primary} onClick={()=>{setTab('approvals');setFilter('all');}}>Review &amp; approve ({totalPending})</button>
        <a className={styles.secondary} href="https://app.metricool.com/planner/calendar?blogId=5373515" target="_blank" rel="noreferrer">Open social planner ↗</a>
        <span style={{ color:C.textDim }}>Generation {current?.generationEnabled ? 'enabled' : 'paused'} · $25 monthly limit</span>
      </div>
      {loadError && <p role="alert" style={{ padding:20, color:'#ffb8b0' }}>{loadError}</p>}
      {/* Stats */}
      <div style={{ padding:'16px 24px', display:'flex', gap:10, flexWrap:'wrap', borderBottom:`1px solid ${C.border}` }}>
        <Stat label="Total" value={records.length + liveJobs.length} />
        <Stat label="Pending" value={totalPending} color={C.amber} />
        <Stat label="Clips scheduled" value={current?.jobs.filter((j:any)=>j.status==='scheduled').length || 0} color="#5aa0d0" />
        <Stat label="Clips published" value={current?.jobs.filter((j:any)=>j.status==='published').length || 0} color={C.green} />
        <Stat label="Copy drafts" value={records.length} color={C.textDim} />
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:`1px solid ${C.border}`, padding:'0 24px', background:C.surface }}>
        {btn('Content Calendar', 'calendar')}
        {btn(`Approvals (${totalPending})`, 'approvals')}
        {btn('Generation Log', 'genlog')}
        {btn('Publish Log', 'publog')}
        {btn('Weekly Brief', 'brief')}
        {btn('Website Programming', 'website')}
      </div>

      <p style={{ padding:'8px 24px', color:C.textDim }}>Open a card to inspect, edit and approve. Dates in titles are original planning dates. Approval and scheduling are separate steps. Status refreshes every minute while this dashboard is open.</p>
      {/* Body */}
      <div style={{ padding:'20px 24px' }}>
        {loading ? <div style={{ textAlign:'center', padding:60, color:C.muted }}>Loading…</div> : (
          <>
            {tab==='website' && <SiteContentPanel/>}
            {['calendar','approvals'].includes(tab) && <>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
                {['all','pending_approval','approved','scheduled','published','failed'].map(status=><button key={status} onClick={()=>{setTab('calendar');setFilter(status);}} style={{background:filter===status?C.accent:C.card,color:filter===status?'#160d05':C.text}}>{status==='all'?'All':STATUS[status]?.label || status}</button>)}
              </div>
              <div className={styles.cards}>
                {shownJobs.map((job:any)=> {
                  const asset=current.assets.find((a:any)=>a.id===job.canonical_asset_id);
                  return <article className={styles.card} key={job.id}>
                    {job.previewUrl && <video src={job.previewUrl} poster={asset?.url} controls preload="metadata"/>}
                    <div className={styles.cardBody}>
                      <Badge status={job.status}/><span style={{color:C.textDim}}> · Video</span>
                      <button className={styles.cardTitle} onClick={()=>setDetail({kind:'video',id:job.id})}>{job.title}</button>
                      <p>{job.caption}</p>
                      <button className={job.status==='pending_qa'?styles.approve:styles.secondary} onClick={()=>setDetail({kind:'video',id:job.id})}>{job.status==='pending_qa'?'✓ Review & approve':'Open draft & details'}</button>
                      {job.blocker && <p style={{color:C.textDim}}>{job.status==='scheduled'?'Scheduling receipt available.':job.blocker}</p>}
                    </div>
                  </article>;
                })}
                {filtered.map(rec=>{const f=rec.fields; return <article className={styles.card} key={rec.id} style={{borderLeft:`3px solid ${AGENT_COLOR[f.Agent]||C.accent}`}}>
                  <div className={styles.cardBody}>
                    <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:AGENT_COLOR[f.Agent]||C.textDim}}>{CH_ICON[f.Channel]||f.Channel} · {f.Agent}</span><Badge status={f.Status}/></div>
                    <button className={styles.cardTitle} onClick={()=>openDraft(rec)}>{f.Title}</button>
                    <p style={{display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{f['Copy Draft']}</p>
                    {/Jun.*2026/.test(f.Title||'') && <p style={{color:C.amber}}>June draft · review for current use</p>}
                    {f['Media URL'] && <p>Media attached · open details to preview</p>}
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      <button className={styles.secondary} onClick={()=>openDraft(rec)}>Open draft &amp; details</button>
                      {f.Status==='pending_approval' && <button className={styles.approve} onClick={()=>openDraft(rec)}>✓ Approve</button>}
                    </div>
                    {f.Status==='approved' && <p style={{color:C.amber}}>Copy approved · scheduling pending</p>}
                  </div>
                </article>})}
              </div>
              {!shownJobs.length && !filtered.length && <p>No items in this view.</p>}
            </>}
            {tab==='genlog' && <div style={{marginBottom:24}}><h2>Current generation status</h2>{liveJobs.map((j:any)=><p key={j.id}><strong>{j.title}</strong> · {j.status} · {j.blocker || 'No blocker recorded'}</p>)}</div>}
            {tab==='publog' && <div style={{marginBottom:24}}><h2>Current video delivery</h2>{liveJobs.map((j:any)=><p key={j.id}><strong>{j.title}</strong> · {j.status}<br/>{j.blocker || (j.status==='approved'?'Approved; awaiting scheduling':'No delivery receipt recorded')}</p>)}<p>Older delivery attempts below are retained with their original result notes.</p></div>}
            {/* GEN LOG */}
            {tab==='genlog' && (
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>{['Run Type','Date','Created','Failed','Triggered By','Notes'].map(h=><th key={h} style={{ textAlign:'left', padding:'8px 10px', fontSize:10, color:C.textDim, borderBottom:`1px solid ${C.border}`, letterSpacing:'0.08em', textTransform:'uppercase' }}>{h}</th>)}</tr></thead>
                <tbody>{genLog.map(r=>{ const f=r.fields||{}; return (
                  <tr key={r.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'10px', fontSize:12, color:C.accent, fontWeight:600 }}>{f['Run Type']||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.textDim }}>{f['Run Date']?new Date(f['Run Date']).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'}</td>
                    <td style={{ padding:'10px', fontSize:13, fontWeight:700, color:C.green }}>{f['Items Created']??'—'}</td>
                    <td style={{ padding:'10px', fontSize:13, fontWeight:700, color:f['Items Failed']>0?C.red:C.muted }}>{f['Items Failed']??'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.textDim }}>{f['Triggered By']||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.muted, maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.Notes||'—'}</td>
                  </tr>
                );})}
                {genLog.length===0&&<tr><td colSpan={6} style={{ textAlign:'center', color:C.muted, padding:30 }}>No runs yet.</td></tr>}
                </tbody>
              </table>
            )}

            {/* PUB LOG */}
            {tab==='publog' && (
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>{['Title','Channel','Format','Published','Status','Platform ID'].map(h=><th key={h} style={{ textAlign:'left', padding:'8px 10px', fontSize:10, color:C.textDim, borderBottom:`1px solid ${C.border}`, letterSpacing:'0.08em', textTransform:'uppercase' }}>{h}</th>)}</tr></thead>
                <tbody>{pubLog.map(r=>{ const f=r.fields||{}; const draft=/saved as draft|not queued/i.test(f['Error Message']||''); const ok=!draft && f['Publish Status']==='success'; return (
                  <tr key={r.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'10px', fontSize:12, color:C.text }}>{f['Content Title']||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.textDim }}>{CH_ICON[f.Channel]||f.Channel||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.muted }}>{f.Format||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.textDim }}>{f['Published At']?new Date(f['Published At']).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}</td>
                    <td style={{ padding:'10px' }}><span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4, background:ok?'#0a2010':'#2a0a08', color:ok?C.green:C.red }}>{draft ? 'Draft only — not queued' : (f['Publish Status']||'—')}</span><p style={{whiteSpace:'normal'}}>{f['Error Message']}</p></td>
                    <td style={{ padding:'10px', fontSize:10, color:C.muted, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis' }}>{f['Platform ID']||'—'}</td>
                  </tr>
                );})}
                {pubLog.length===0&&<tr><td colSpan={6} style={{ textAlign:'center', color:C.muted, padding:30 }}>No publish events yet.</td></tr>}
                </tbody>
              </table>
            )}

            {/* BRIEF */}
            {tab==='brief' && (
              brief.length===0
                ? <div style={{ textAlign:'center', color:C.muted, padding:60 }}>No historical briefs available.</div>
                : brief.map(r=>{ const f=r.fields||{}; let posts: any[]=[];
                  try { posts=JSON.parse(f['Post Intents']||'[]'); } catch {}
                  return (
                    <div key={r.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:16, marginBottom:12 }}>
                      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10 }}>
                        <Dot agent={f.Agent}/>
                        <span style={{ fontWeight:700, color:AGENT_COLOR[f.Agent]||C.text }}>{f.Agent}</span>
                        <span style={{ color:C.muted }}>·</span>
                        <span style={{ fontSize:11, color:C.textDim }}>{f.Platform}</span>
                        <span style={{ color:C.muted }}>·</span>
                        <span style={{ fontSize:11, color:C.textDim }}>Week of {f['Week Of']}</span>
                        <span style={{ marginLeft:'auto', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4, background:f.Status==='ready'?'#0a1a2a':f.Status==='consumed'?'#0a2010':'#2a1f00', color:f.Status==='ready'?'#5aa0d0':f.Status==='consumed'?C.green:C.amber }}>{f.Status}</span>
                      </div>
                      {posts.map((p:any,i:number)=>(
                        <div key={i} style={{ background:C.surface, borderRadius:4, padding:'8px 12px', fontSize:11, color:C.textDim, display:'flex', gap:12, marginBottom:4 }}>
                          <span style={{ color:C.accent, fontWeight:700, minWidth:16 }}>#{p.slot}</span>
                          <span style={{ color:C.text, minWidth:80 }}>{p.intent}</span>
                          <span style={{ color:C.muted, minWidth:80 }}>{p.pillar}</span>
                          <span style={{ color:C.textDim }}>{p.image_platform}</span>
                          <span style={{ color:C.muted, flex:1 }}>{p.visual_direction}</span>
                        </div>
                      ))}
                      {f['Platform Notes'] && <div style={{ marginTop:8, fontSize:11, color:C.muted, fontStyle:'italic' }}>{f['Platform Notes']}</div>}
                    </div>
                  );
                })
            )}
          </>
        )}
      </div>

      <div style={{ borderTop:`1px solid ${C.border}`, padding:'12px 24px', display:'flex', justifyContent:'space-between', background:C.surface, marginTop:24 }}>
        <span style={{ fontSize:10, color:C.muted }}>Café Sativa Content Engine · Tru Skool Entertainment Intl Corp.</span>
        <span style={{ fontSize:10, color:C.muted }}>admin.cafe-sativa.com</span>
      </div>
    </div>
  );
}
