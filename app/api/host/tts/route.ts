import { isContentAdmin } from '@/lib/content/auth'
import { resolveAllowedOrigin } from '@/lib/cors'
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
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  if(!resolveAllowedOrigin(req.headers.get('origin')))return NextResponse.json({error:'Invalid origin'},{status:403})
  try {
    const { text, voiceId } = await req.json()

    const allowed=[process.env.ELEVENLABS_VOICE_KEITH || process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_KEITH || 'P4TR6ShrGvF741Gei86A',process.env.ELEVENLABS_VOICE_LAVICHE || process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_LAVICHE || 'oNYzGfXKQJfjG1yEuJe9']
    if (typeof text!=='string' || !text.trim() || text.length>2000 || typeof voiceId!=='string' || !allowed.includes(voiceId)) {
      return NextResponse.json({ error: 'Approved host voice and text of at most 2000 characters required' }, { status: 400 })
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })
    }

    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        redirect: 'error',
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
      await elRes.body?.cancel()
      console.error('ElevenLabs TTS error:', elRes.status)
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
