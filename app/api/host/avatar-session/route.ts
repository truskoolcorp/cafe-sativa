import { isContentAdmin } from '@/lib/content/auth'
import { NextRequest, NextResponse } from 'next/server'

const HEYGEN_API = 'https://api.heygen.com'

export async function POST(req: NextRequest) {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
  const input=await req.json().catch(()=>null)
  if(input?.action!=='stop')return NextResponse.json({error:'Video creation is held until the provider avatar is verified against its approved GLYPH primary. Ask voice conversations remain available.'},{status:409})
  if(typeof input.sessionId!=='string' || !/^[a-zA-Z0-9_-]{8,200}$/.test(input.sessionId))return NextResponse.json({error:'Valid existing session required'},{status:400})
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HEYGEN_API_KEY not configured' }, { status: 500 })
  const body = input
  const { action } = body
  try {
    switch (action) {
      case 'new': {
        const res = await fetch(`${HEYGEN_API}/v1/streaming.new`, {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({ quality: 'medium', avatar_name: body.avatarId, voice: { voice_id: body.voiceId || '' } }),
        })
        const data = await res.json()
        if (!res.ok) return NextResponse.json({ error: data }, { status: res.status })
        return NextResponse.json(data.data)
      }
      case 'start': {
        const res = await fetch(`${HEYGEN_API}/v1/streaming.start`, {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({ session_id: body.sessionId, sdp: body.sdp }),
        })
        const data = await res.json()
        if (!res.ok) return NextResponse.json({ error: data }, { status: res.status })
        return NextResponse.json(data.data ?? {})
      }
      case 'ice': {
        const res = await fetch(`${HEYGEN_API}/v1/streaming.ice`, {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({ session_id: body.sessionId, candidate: body.candidate }),
        })
        const data = await res.json()
        if (!res.ok) return NextResponse.json({ error: data }, { status: res.status })
        return NextResponse.json(data.data ?? {})
      }
      case 'speak': {
        const res = await fetch(`${HEYGEN_API}/v1/streaming.task`, {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({ session_id: body.sessionId, text: body.text, task_type: 'talk' }),
        })
        const data = await res.json()
        if (!res.ok) return NextResponse.json({ error: data }, { status: res.status })
        return NextResponse.json(data.data ?? {})
      }
      case 'stop': {
        const res = await fetch(`${HEYGEN_API}/v1/streaming.stop`, {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({ session_id: body.sessionId }),
        })
        const data = await res.json()
        if (!res.ok) return NextResponse.json({ error: data }, { status: res.status })
        return NextResponse.json(data.data ?? {})
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    console.error('/api/host/avatar-session error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
