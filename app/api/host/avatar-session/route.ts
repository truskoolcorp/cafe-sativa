import { NextRequest, NextResponse } from 'next/server'

const HEYGEN_API = 'https://api.heygen.com'

export async function POST(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HEYGEN_API_KEY not configured' }, { status: 500 })
  const body = await req.json()
  const { action } = body
  try {
    switch (action) {
      case 'new': {
        const res = await fetch(`${HEYGEN_API}/v1/streaming.new`, {
          method: 'POST',
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
