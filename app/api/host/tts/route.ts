import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/host/tts
 *
 * Proxies text to ElevenLabs TTS and returns raw audio/mpeg stream.
 * The client creates an object URL from the blob and plays it directly.
 *
 * Body: { text: string, voiceId: string }
 * Response: audio/mpeg binary stream
 */
export async function POST(req: NextRequest) {
  try {
    const { text, voiceId } = await req.json()

    if (!text || !voiceId) {
      return NextResponse.json({ error: 'Missing text or voiceId' }, { status: 400 })
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })
    }

    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!elRes.ok) {
      const err = await elRes.text()
      console.error('ElevenLabs TTS error:', err)
      return NextResponse.json({ error: 'TTS API error' }, { status: 502 })
    }

    // Stream audio bytes directly to client
    const audioBuffer = await elRes.arrayBuffer()
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
        'Cache-Control': 'no-store',
      },
    })

  } catch (err) {
    console.error('/api/host/tts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
