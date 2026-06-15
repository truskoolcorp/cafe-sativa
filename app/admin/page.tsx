'use client';
import { useState, useEffect, useCallback } from 'react';

// All Airtable calls go through /api/admin/airtable — PAT never exposed client-side
async function atGet(table: string, params = '') {
  const r = await fetch(`/api/admin/airtable?table=${table}&params=${encodeURIComponent(params)}`);
  return r.json();
}
async function atPatch(table: string, recordId: string, fields: Record<string, unknown>) {
  const r = await fetch(`/api/admin/airtable?table=${table}&recordId=${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
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
    const [cal, gen, pub, br] = await Promise.all([
      atGet('calendar',   '?maxRecords=50&sort[0][field]=Title&sort[0][direction]=asc'),
      atGet('genLog',     '?maxRecords=20&sort[0][field]=Run+Date&sort[0][direction]=desc'),
      atGet('publishLog', '?maxRecords=20&sort[0][field]=Published+At&sort[0][direction]=desc'),
      atGet('brief',      '?maxRecords=10&sort[0][field]=Week+Of&sort[0][direction]=desc'),
    ]);
    setRecords(cal.records || []);
    setGenLog(gen.records  || []);
    setPubLog(pub.records  || []);
    setBrief(br.records    || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const approve = async (rec: any) => {
    setActing(rec.id);
    const res = await atPatch('calendar', rec.id, { Status: 'approved' });
    if (res.id) { setRecords(p => p.map(r => r.id === rec.id ? { ...r, fields: { ...r.fields, Status: 'approved' } } : r)); showToast(`✓ Approved`); }
    else showToast('Failed', false);
    setActing(null);
  };
  const reject = async (rec: any) => {
    setActing(rec.id);
    const res = await atPatch('calendar', rec.id, { Status: 'pending_approval' });
    if (res.id) { setRecords(p => p.map(r => r.id === rec.id ? { ...r, fields: { ...r.fields, Status: 'pending_approval' } } : r)); showToast('Returned to pending'); }
    else showToast('Failed', false);
    setActing(null);
  };

  const counts = records.reduce((a: Record<string,number>, r) => { const s = r.fields?.Status || 'unknown'; a[s] = (a[s]||0)+1; return a; }, {});
  const pending  = records.filter(r => r.fields?.Status === 'pending_approval');
  const filtered = filter === 'all' ? records : records.filter(r => r.fields?.Status === filter);

  const btn = (label: string, key: string) => (
    <button key={key} onClick={() => setTab(key)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px', fontSize: 12, fontWeight: tab===key ? 700 : 400, color: tab===key ? C.accent : C.textDim, borderBottom: tab===key ? `2px solid ${C.accent}` : '2px solid transparent', letterSpacing: '0.03em' }}>{label}</button>
  );

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", fontSize: 13 }}>
      {toast && <div style={{ position:'fixed', top:16, right:16, zIndex:9999, background: toast.ok?'#0a2010':'#2a0a08', border:`1px solid ${toast.ok?C.green:C.red}`, color:toast.ok?C.green:C.red, padding:'10px 16px', borderRadius:6, fontSize:12, fontWeight:600 }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between', height:52, background:C.surface }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:6, background:`linear-gradient(135deg,${C.accent},${C.roseGold})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>🌿</div>
          <span style={{ fontWeight:700, fontSize:14, letterSpacing:'-0.02em' }}>Café Sativa</span>
          <span style={{ color:C.muted, fontSize:12 }}>/ Content Engine</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {pending.length > 0 && <span style={{ background:C.amber, color:'#0d0a07', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10 }}>{pending.length} pending</span>}
          <button onClick={loadAll} style={{ background:'none', border:`1px solid ${C.border}`, color:C.textDim, padding:'5px 12px', borderRadius:5, cursor:'pointer', fontSize:11 }}>↻ Refresh</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding:'16px 24px', display:'flex', gap:10, flexWrap:'wrap', borderBottom:`1px solid ${C.border}` }}>
        <Stat label="Total"     value={records.length}              />
        <Stat label="Pending"   value={counts.pending_approval||0}  color={C.amber} />
        <Stat label="Scheduled" value={counts.scheduled||0}         color="#5aa0d0" />
        <Stat label="Published" value={counts.published||0}         color={C.green} />
        <Stat label="Failed"    value={counts.failed||0}            color={C.red}   />
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:`1px solid ${C.border}`, padding:'0 24px', background:C.surface }}>
        {btn('Content Calendar', 'calendar')}
        {btn(`Approvals${pending.length ? ` (${pending.length})` : ''}`, 'approvals')}
        {btn('Generation Log', 'genlog')}
        {btn('Publish Log', 'publog')}
        {btn('Weekly Brief', 'brief')}
      </div>

      {/* Body */}
      <div style={{ padding:'20px 24px' }}>
        {loading ? <div style={{ textAlign:'center', padding:60, color:C.muted }}>Loading…</div> : (
          <>
            {/* CALENDAR */}
            {tab==='calendar' && (
              <div>
                <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' }}>
                  {['all','pending_approval','approved','scheduled','published','failed'].map(s => (
                    <button key={s} onClick={() => setFilter(s)} style={{ background:filter===s?C.accent:C.card, border:`1px solid ${filter===s?C.accent:C.border}`, color:filter===s?'#0d0a07':C.textDim, padding:'4px 12px', borderRadius:4, cursor:'pointer', fontSize:11, fontWeight:filter===s?700:400, textTransform:'capitalize' }}>
                      {s==='all'?'All':(STATUS[s]?.label||s)}{s!=='all'&&counts[s]?` · ${counts[s]}`:''}
                    </button>
                  ))}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:12 }}>
                  {filtered.map(rec => {
                    const f = rec.fields||{}; const ag = f.Agent||'?'; const ia = acting===rec.id;
                    return (
                      <div key={rec.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:16, borderLeft:`3px solid ${AGENT_COLOR[ag]||C.muted}` }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ background:C.surface, color:C.textDim, fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:3 }}>{CH_ICON[f.Channel]||'?'}</span>
                            <Dot agent={ag}/><span style={{ fontSize:11, color:AGENT_COLOR[ag]||C.textDim, fontWeight:600 }}>{ag}</span>
                          </div>
                          <Badge status={f.Status}/>
                        </div>
                        <div style={{ fontSize:12, fontWeight:600, color:C.text, marginBottom:6, lineHeight:1.4 }}>{f.Title||'Untitled'}</div>
                        {f['Copy Draft'] && <div style={{ fontSize:11, color:C.textDim, lineHeight:1.5, marginBottom:8, display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{f['Copy Draft']}</div>}
                        {f['Media URL'] && (
                          f['Media URL'].match(/\.(mp4|webm|mov)/i)
                            ? <video src={f['Media URL']} controls muted style={{ width:'100%', borderRadius:4, maxHeight:160, background:'#000', marginBottom:8 }}/>
                            : <img src={f['Media URL']} alt="" style={{ width:'100%', borderRadius:4, maxHeight:160, objectFit:'cover', marginBottom:8 }} onError={e=>(e.currentTarget.style.display='none')}/>
                        )}
                        {f.Status==='pending_approval' && (
                          <div style={{ display:'flex', gap:6, marginTop:8 }}>
                            <button onClick={()=>approve(rec)} disabled={ia} style={{ flex:1, background:'#0a2010', border:`1px solid ${C.green}`, color:C.green, padding:'6px 0', borderRadius:4, cursor:ia?'not-allowed':'pointer', fontSize:11, fontWeight:700, opacity:ia?0.5:1 }}>{ia?'…':'✓ Approve'}</button>
                            <button onClick={()=>reject(rec)}  disabled={ia} style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, color:C.textDim, padding:'6px 0', borderRadius:4, cursor:ia?'not-allowed':'pointer', fontSize:11, opacity:ia?0.5:1 }}>Reject</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filtered.length===0 && <div style={{ gridColumn:'1/-1', textAlign:'center', color:C.muted, padding:40 }}>No posts in this status.</div>}
                </div>
              </div>
            )}

            {/* APPROVALS */}
            {tab==='approvals' && (
              <div>
                {pending.length===0
                  ? <div style={{ textAlign:'center', color:C.muted, padding:60 }}>All clear — nothing pending.</div>
                  : pending.map(rec => {
                    const f=rec.fields||{}; const ag=f.Agent||'?'; const ia=acting===rec.id;
                    return (
                      <div key={rec.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:16, display:'flex', gap:16, marginBottom:10, borderLeft:`3px solid ${AGENT_COLOR[ag]||C.muted}` }}>
                        {f['Media URL'] && <div style={{ width:100, flexShrink:0 }}>
                          {f['Media URL'].match(/\.(mp4|webm|mov)/i)
                            ? <video src={f['Media URL']} muted style={{ width:'100%', borderRadius:4, height:100, objectFit:'cover' }}/>
                            : <img src={f['Media URL']} alt="" style={{ width:'100%', borderRadius:4, height:100, objectFit:'cover' }} onError={e=>(e.currentTarget.style.display='none')}/>}
                        </div>}
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6 }}>
                            <span style={{ background:C.surface, color:C.textDim, fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:3 }}>{CH_ICON[f.Channel]||'?'}</span>
                            <Dot agent={ag}/><span style={{ fontSize:12, fontWeight:600, color:AGENT_COLOR[ag] }}>{ag}</span>
                            <span style={{ fontSize:11, color:C.textDim }}>{f.Title}</span>
                          </div>
                          {f['Copy Draft'] && <div style={{ fontSize:12, color:C.text, lineHeight:1.5, marginBottom:6 }}>{f['Copy Draft']}</div>}
                          {f.Hashtags && <div style={{ fontSize:11, color:C.accent, marginBottom:8 }}>{f.Hashtags}</div>}
                          <div style={{ display:'flex', gap:6 }}>
                            <button onClick={()=>approve(rec)} disabled={ia} style={{ background:'#0a2010', border:`1px solid ${C.green}`, color:C.green, padding:'6px 20px', borderRadius:4, cursor:ia?'not-allowed':'pointer', fontSize:12, fontWeight:700, opacity:ia?0.5:1 }}>{ia?'…':'✓ Approve'}</button>
                            <button onClick={()=>reject(rec)}  disabled={ia} style={{ background:C.surface, border:`1px solid ${C.border}`, color:C.textDim, padding:'6px 20px', borderRadius:4, cursor:ia?'not-allowed':'pointer', fontSize:12, opacity:ia?0.5:1 }}>Return</button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            )}

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
                <tbody>{pubLog.map(r=>{ const f=r.fields||{}; const ok=f['Publish Status']==='success'; return (
                  <tr key={r.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'10px', fontSize:12, color:C.text }}>{f['Content Title']||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.textDim }}>{CH_ICON[f.Channel]||f.Channel||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.muted }}>{f.Format||'—'}</td>
                    <td style={{ padding:'10px', fontSize:11, color:C.textDim }}>{f['Published At']?new Date(f['Published At']).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}</td>
                    <td style={{ padding:'10px' }}><span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4, background:ok?'#0a2010':'#2a0a08', color:ok?C.green:C.red }}>{f['Publish Status']||'—'}</span></td>
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
                ? <div style={{ textAlign:'center', color:C.muted, padding:60 }}>No briefs yet. Anya fires Sunday 8pm CDT.</div>
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
