import { isContentAdmin } from '@/lib/content/auth'
import { liveGlyphCharacters } from '@/lib/content/glyph-live'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/host/respond
 *
 * Receives a guest utterance + host persona + conversation history.
 * Returns an in-character response from Keith or Laviche via Claude.
 *
 * Body: { host, persona, guestText, history }
 * Response: { response: string }
 */
export const maxDuration=60
export async function POST(req: NextRequest) {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
  try {
    const { host, guestText, history = [] } = await req.json()

    if (!['keith','laviche'].includes(host) || typeof guestText!=='string' || !guestText.trim() || guestText.length>2000 || !Array.isArray(history) || history.length>50 || history.some((message:any)=>!['user','assistant'].includes(message?.role) || typeof message.content!=='string' || message.content.length>2000)) {
      return NextResponse.json({ error: 'Known host and bounded conversation required' }, { status: 400 })
    }

    const source=await liveGlyphCharacters()
    const character=source.characters.find((c:any)=>c.id===(host==='keith'?'keith':'laviche-fea'))
    if(source.live!==true || character?.production_ready!==true || !character.canonical_context)return NextResponse.json({error:'Approved character context unavailable; no substitute persona used.'},{status:409})
    const persona=`Use only this approved GLYPH character context: ${character.canonical_context}\nCafé Sativa is a virtual venue concept. Its physical Tenerife opening is planned for 2027; the exact date and property are unconfirmed. Do not invent appearances, products, events or bookings.`
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    // Build messages array from history + current guest utterance
    const messages = [
      ...history.slice(-8),
      { role: 'user', content: `Guest says: "${guestText}"\n\nRespond in character. Keep it 2-4 sentences. Speak naturally, as if live on air.` }
    ]

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        system: persona,
        messages,
      })
    })

    if (!claudeRes.ok) {
      await claudeRes.body?.cancel()
      console.error('Claude API error:', claudeRes.status)
      return NextResponse.json({ error: 'Claude API error' }, { status: 502 })
    }

    const data = await claudeRes.json()
    const response = data.content?.[0]?.text ?? ''

    return NextResponse.json({ response, host })

  } catch (err) {
    console.error('/api/host/respond error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
