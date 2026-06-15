'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type HostId = 'keith' | 'laviche'
type MsgRole = 'keith' | 'laviche' | 'guest' | 'system'
interface Message { id:string; role:MsgRole; speaker:string; text:string; ts:Date; pending?:boolean }
interface Pipeline { claude:'idle'|'thinking'|'done'|'error'; tts:'idle'|'generating'|'playing'|'error'; avatar:'idle'|'animating'|'error' }

const VOICES = { keith: process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_KEITH||'9I3zeSiEilh5b2sSFWdK', laviche: process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_LAVICHE||'v0r5L5uDA6ocN9hjTPYK' }
const HEYGEN = { keith: process.env.NEXT_PUBLIC_HEYGEN_AVATAR_KEITH||'e9a45c47c2514c4f899cc00460c981a2', laviche: process.env.NEXT_PUBLIC_HEYGEN_AVATAR_LAVICHE||'b320213eeaf94f16a3ec32ca4fd99574' }
const PERSONAS = {
  keith: `You are Keith Ingram — founder and CEO of Café Sativa, Dallas-born, Gulf War veteran, IT specialist turned cultural architect. You host At The Table, an intimate live conversation series. Tone: warm, direct, thoughtful, occasionally funny. Speak in complete sentences. No filler words. 2-4 sentences unless the moment calls for more.`,
  laviche: `You are Laviche Cárdenas — co-host of At The Table and the heartbeat of Café Sativa. Warmth, depth, poetic sensibility. Occasional Spanish endearments (amores, mija/mijo, corazón). Center the emotional truth in what guests say. Tone: luminous, curious, grounding. 2-4 sentences. Hold space before pivoting. Never rush.`,
}
const C = { bg:'#0a0705',surface:'#130e08',card:'#1a1208',border:'#2c1e0c',borderBright:'#4a3218',gold:'#b8813a',goldDim:'#7a5526',green:'#3d9e6a',red:'#9e3d3d',amber:'#d4902a',text:'#e8ddd0',textDim:'#9e8870',muted:'#5a4535',keith:'#6ab8d4',keithBg:'#0d2535',laviche:'#d4729a',lavicheBg:'#2d0f1e' }
const ALLOWED = ['truskoolcorp@truskool.net','kingram292@gmail.com']
const ZOOM_START = 'https://us04web.zoom.us/s/5967487696'
function uid() { return Math.random().toString(36).slice(2) }
function fmt(d:Date) { return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) }

export default function AvatarHostPage() {
  const [authed, setAuthed] = useState<boolean|null>(null)
  const [host, setHost] = useState<HostId>('keith')
  const [msgs, setMsgs] = useState<Message[]>([{id:uid(),role:'system',speaker:'System',ts:new Date(),text:'Host console ready. Use Quick Lines to deliver scripted content, or paste guest input for AI response.'}])
  const [guestInput, setGuestInput] = useState('')
  const [scriptLine, setScriptLine] = useState('')
  const [pipe, setPipe] = useState<Pipeline>({claude:'idle',tts:'idle',avatar:'idle'})
  const [live, setLive] = useState(false)
  const [audio] = useState(()=> typeof window!=='undefined' ? new Audio() : null)
  const logRef = useRef<HTMLDivElement>(null)

  // Auth gate
  useEffect(()=>{
    createClient().auth.getUser().then(({data})=>{
      setAuthed(ALLOWED.includes(data?.user?.email??''))
    })
  },[])

  // Escape Next.js layout — hide nav/footer, take full viewport
  useEffect(()=>{
    const el = document.createElement('style')
    el.id = 'hc-escape'
    el.textContent = `header.fixed,footer,.fixed{display:none!important}main.flex-1{padding:0!important;margin:0!important}body{overflow:hidden!important}`
    document.head.appendChild(el)
    return ()=>document.getElementById('hc-escape')?.remove()
  },[])

  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight },[msgs])

  const addMsg = useCallback((role:MsgRole,speaker:string,text:string,pending=false)=>{
    const id=uid(); setMsgs(p=>[...p,{id,role,speaker,text,ts:new Date(),pending}]); return id
  },[])
  const resolveMsg = useCallback((id:string,text:string)=>{
    setMsgs(p=>p.map(m=>m.id===id?{...m,text,pending:false}:m))
  },[])

  const speakText = useCallback(async(text:string,h:HostId)=>{
    setPipe(p=>({...p,tts:'generating'}))
    try {
      const res = await fetch('/api/host/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voiceId:VOICES[h]})})
      const blob = await res.blob(); const url = URL.createObjectURL(blob)
      if(audio){
        audio.src=url
        audio.onplay=()=>{ setPipe(p=>({...p,tts:'playing'})); fetch('/api/host/avatar-speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,avatarId:HEYGEN[h]})}).catch(()=>{}); setPipe(p=>({...p,avatar:'animating'})) }
        audio.onended=()=>{ setPipe(p=>({...p,tts:'idle',avatar:'idle'})); URL.revokeObjectURL(url) }
        await audio.play()
      }
    } catch { setPipe(p=>({...p,tts:'error'})) }
  },[audio])

  const generateResponse = useCallback(async(guestText:string)=>{
    if(!guestText.trim()||pipe.claude==='thinking') return
    addMsg('guest','Guest',guestText); setGuestInput('')
    const h=host; const name=h==='keith'?'Keith Ingram':'Laviche Cárdenas'
    const pid=addMsg(h,name,'...',true); setPipe(p=>({...p,claude:'thinking'}))
    try {
      const res=await fetch('/api/host/respond',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({host:h,persona:PERSONAS[h],guestText,
          history:msgs.slice(-8).map(m=>({role:m.role==='guest'?'user':'assistant',content:`[${m.speaker}]: ${m.text}`}))
        })})
      const {response}=await res.json()
      resolveMsg(pid,response); setPipe(p=>({...p,claude:'done'}))
      await speakText(response,h)
    } catch { resolveMsg(pid,'[Error — check ANTHROPIC_API_KEY]'); setPipe(p=>({...p,claude:'error'})) }
  },[pipe.claude,host,msgs,addMsg,resolveMsg,speakText])

  const speakScript = useCallback(async()=>{
    if(!scriptLine.trim()) return
    const h=host; const name=h==='keith'?'Keith Ingram':'Laviche Cárdenas'
    addMsg(h,name,scriptLine); const line=scriptLine; setScriptLine('')
    await speakText(line,h)
  },[scriptLine,host,addMsg,speakText])

  const pc=(s:string)=> s==='idle'?C.muted:s==='thinking'||s==='generating'||s==='animating'?C.amber:s==='playing'||s==='done'?C.green:C.red

  const QL = [
    {h:'keith' as HostId, t:"Welcome to the table, family. This is what we built Café Sativa for — real conversation, real people."},
    {h:'laviche' as HostId, t:"Bienvenidos, amores. Your presence here tonight means everything."},
    {h:'keith' as HostId, t:"The floor is open — who wants to share first?"},
    {h:'laviche' as HostId, t:"That is so beautifully said. Can I sit with that for a moment?"},
    {h:'keith' as HostId, t:"Man, I appreciate y’all being here. This is exactly what Café Sativa is about."},
    {h:'laviche' as HostId, t:"What you just shared — that is the whole reason we built this table."},
    {h:'keith' as HostId, t:"Thank you for being at the table tonight. Y’all made this real."},
    {h:'laviche' as HostId, t:"Until next time — keep glowing, keep growing. Besitos, amores."},
  ]

  if(authed===null) return <div style={{background:C.bg,height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.muted,fontSize:13,fontFamily:'Inter,sans-serif'}}>Verifying access…</div>
  if(!authed) return (
    <div style={{background:C.bg,height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:14,fontFamily:'Inter,sans-serif'}}>
      <div style={{fontSize:13,color:C.red,fontWeight:700}}>Access denied</div>
      <div style={{fontSize:12,color:C.muted}}>Sign in as the host account to use this console.</div>
      <a href="/auth/signin?redirect=/host/avatar" style={{color:C.gold,fontSize:12}}>Sign in →</a>
    </div>
  )

  return (
    <div style={{background:C.bg,height:'100vh',display:'grid',gridTemplateRows:'48px 1fr',overflow:'hidden',fontFamily:"'Inter',-apple-system,sans-serif",color:C.text}}>
      <style>{`@keyframes sw{from{transform:scaleY(0.3)}to{transform:scaleY(1)}}*{box-sizing:border-box;margin:0;padding:0}textarea{resize:none;outline:none;font-family:inherit}button{cursor:pointer;font-family:inherit}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${C.borderBright};border-radius:3px}`}</style>

      {/* Topbar */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',padding:'0 18px',gap:14}}>
        <span style={{fontSize:12,fontWeight:700,color:C.gold,letterSpacing:'0.08em',textTransform:'uppercase'}}>Café Sativa</span>
        <span style={{color:C.muted,fontSize:12}}>› Host Console</span>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12}}>
          {(['claude','tts','avatar'] as const).map(k=>(
            <span key={k} style={{fontSize:10,color:pc(pipe[k])}}>{k}:{pipe[k]}</span>
          ))}
          <div style={{fontSize:10,fontWeight:700,padding:'2px 10px',borderRadius:20,background:live?'#0d2a18':C.card,border:`1px solid ${live?C.green:C.border}`,color:live?C.green:C.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
            {live?'● Live':'Offline'}
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',overflow:'hidden'}}>

        {/* Left */}
        <div style={{display:'grid',gridTemplateRows:'190px 1fr',overflow:'hidden',borderRight:`1px solid ${C.border}`}}>

          {/* Stage */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:C.border}}>
            {(['keith','laviche'] as HostId[]).map(h=>{
              const spk = pipe.tts==='playing' && host===h
              const col = h==='keith'?C.keith:C.laviche
              return (
                <div key={h} style={{background:spk?(h==='keith'?C.keithBg:C.lavicheBg):C.card,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,padding:14,position:'relative',transition:'background 0.3s'}}>
                  <div style={{width:72,height:72,borderRadius:'50%',border:`2px solid ${spk?col:C.borderBright}`,boxShadow:spk?`0 0 16px ${col}44`:'none',background:C.surface,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:700,color:spk?col:C.textDim,transition:'all 0.3s'}}>
                    {h==='keith'?'KI':'LC'}
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text}}>{h==='keith'?'Keith Ingram':'Laviche Cárdenas'}</div>
                    <div style={{fontSize:10,color:C.textDim,marginTop:1}}>{h==='keith'?'Founder & Host':'Co-Host & Concierge'}</div>
                  </div>
                  {spk&&<div style={{display:'flex',gap:2,position:'absolute',bottom:8}}>
                    {[6,11,8,13,6].map((ht,i)=>(<div key={i} style={{width:2,borderRadius:2,background:col,height:ht,animation:`sw 0.8s ease-in-out ${i*0.1}s infinite alternate`}}/>))}
                  </div>}
                </div>
              )
            })}
          </div>

          {/* Transcript */}
          <div style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{padding:'8px 16px',borderBottom:`1px solid ${C.border}`,fontSize:10,fontWeight:700,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase'}}>Transcript</div>
            <div ref={logRef} style={{flex:1,overflowY:'auto',padding:'12px 16px',display:'flex',flexDirection:'column',gap:10}}>
              {msgs.map(m=>(
                <div key={m.id}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                    <span style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:8,textTransform:'uppercase',letterSpacing:'0.08em',
                      background:m.role==='keith'?C.keithBg:m.role==='laviche'?C.lavicheBg:C.card,
                      color:m.role==='keith'?C.keith:m.role==='laviche'?C.laviche:C.textDim,
                      border:`1px solid ${m.role==='keith'?C.keith+'44':m.role==='laviche'?C.laviche+'44':C.border}`}}>{m.speaker}</span>
                    <span style={{fontSize:9,color:C.muted}}>{fmt(m.ts)}</span>
                  </div>
                  <div style={{fontSize:12,lineHeight:1.6,color:m.pending?C.muted:C.textDim,fontStyle:m.pending?'italic':'normal',paddingLeft:1}}>{m.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: controls */}
        <div style={{background:C.surface,display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* Session */}
          <div style={{padding:12,borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:7}}>Session</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              <button onClick={()=>{setLive(true);addMsg('system','System','Session started.')}} style={{padding:'8px 0',borderRadius:5,border:'none',background:C.green,color:'#0a0705',fontSize:11,fontWeight:700}}>▶ Go Live</button>
              <button onClick={()=>{setLive(false);addMsg('system','System','Session ended.')}} style={{padding:'8px 0',borderRadius:5,border:`1px solid ${C.border}`,background:'transparent',color:C.textDim,fontSize:11,fontWeight:700}}>■ End</button>
            </div>
            <a href={ZOOM_START} target="_blank" rel="noopener noreferrer"
              style={{display:'block',marginTop:6,padding:'7px 0',borderRadius:5,border:`1px solid ${C.borderBright}`,background:'transparent',color:C.textDim,fontSize:11,fontWeight:600,textAlign:'center',textDecoration:'none'}}>Open Zoom ↗</a>
          </div>

          {/* Host */}
          <div style={{padding:12,borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:7}}>Speaking as</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              {(['keith','laviche'] as HostId[]).map(h=>(
                <button key={h} onClick={()=>setHost(h)} style={{padding:'7px 0',borderRadius:5,fontSize:11,fontWeight:600,
                  background:host===h?(h==='keith'?C.keithBg:C.lavicheBg):C.card,
                  border:`1px solid ${host===h?(h==='keith'?C.keith:C.laviche):C.borderBright}`,
                  color:host===h?(h==='keith'?C.keith:C.laviche):C.textDim}}>
                  {h==='keith'?'Keith':'Laviche'}</button>
              ))}
            </div>
          </div>

          {/* Guest → AI */}
          <div style={{padding:12,borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:7}}>Guest says → AI responds</div>
            <textarea value={guestInput} onChange={e=>setGuestInput(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))generateResponse(guestInput)}}
              placeholder="Paste guest’s words… ⌘+Enter"
              style={{width:'100%',height:64,background:C.card,border:`1px solid ${C.borderBright}`,borderRadius:5,padding:'8px 10px',color:C.text,fontSize:12,lineHeight:1.5}}/>
            <button onClick={()=>generateResponse(guestInput)} disabled={pipe.claude==='thinking'||!guestInput.trim()}
              style={{marginTop:5,width:'100%',padding:'8px 0',borderRadius:5,border:'none',background:pipe.claude==='thinking'?C.goldDim:C.gold,color:'#0a0705',fontSize:11,fontWeight:700,opacity:!guestInput.trim()?0.5:1}}>
              {pipe.claude==='thinking'?'Thinking…':`Respond as ${host==='keith'?'Keith':'Laviche'} →`}
            </button>
          </div>

          {/* Scripted line */}
          <div style={{padding:12,borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:7}}>Scripted line — bypasses AI</div>
            <textarea value={scriptLine} onChange={e=>setScriptLine(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))speakScript()}}
              placeholder="Type exact line — goes straight to TTS…"
              style={{width:'100%',height:52,background:C.card,border:`1px solid ${C.borderBright}`,borderRadius:5,padding:'8px 10px',color:C.text,fontSize:12}}/>
            <button onClick={speakScript}
              style={{marginTop:5,width:'100%',padding:'7px 0',borderRadius:5,border:`1px solid ${C.borderBright}`,background:'transparent',color:C.textDim,fontSize:11,fontWeight:700}}>Speak →</button>
          </div>

          {/* Quick lines */}
          <div style={{flex:1,overflowY:'auto',padding:12}}>
            <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:7}}>Quick lines</div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {QL.map((q,i)=>(
                <button key={i} onClick={()=>{setHost(q.h);setScriptLine(q.t)}}
                  style={{padding:'7px 9px',background:C.card,border:`1px solid ${C.border}`,borderRadius:5,color:C.textDim,fontSize:10,textAlign:'left',lineHeight:1.4}}>
                  <span style={{fontSize:8,fontWeight:700,color:q.h==='keith'?C.keith:C.laviche,textTransform:'uppercase',letterSpacing:'0.08em',display:'block',marginBottom:2}}>{q.h}</span>
                  {q.t.length>76?q.t.slice(0,76)+'…':q.t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
