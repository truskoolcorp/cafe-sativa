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
export async function POST(req: NextRequest) {
  try {
    const { host, persona, guestText, history = [] } = await req.json()

    if (!guestText || !persona) {
      return NextResponse.json({ error: 'Missing guestText or persona' }, { status: 400 })
    }

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
      const err = await claudeRes.text()
      console.error('Claude API error:', err)
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
