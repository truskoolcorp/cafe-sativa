import { corsHeaders, preflight, jsonWithCors } from '@/lib/cors'

/**
 * POST /api/concierge/speak
 *
 * Speaks a concierge reply in the host's voice. This is the *output*
 * half of voice on /ask — it does NOT generate text (that's
 * /api/concierge); it only turns an existing reply into audio.
 *
 * Body: { host: 'laviche' | 'ginger' | 'ahnika', text: string }
 * Returns: audio/mpeg bytes (the spoken reply) on success.
 *
 * The ElevenLabs API key stays server-side — the browser never sees
 * it. Voice IDs are not secrets (they're just identifiers), so they
 * ship as defaults here and can be repointed per-host via env without
 * a code change.
 *
 * Degradation: if ELEVENLABS_API_KEY is unset we return 503
 * not_configured so the client can quietly hide the voice controls
 * rather than erroring mid-conversation.
 */

export const runtime = 'nodejs'
export const maxDuration = 30

type Body = { host?: string; text?: string }

type Host = 'laviche' | 'ginger' | 'ahnika'

// host -> ElevenLabs voice ID. Env override: ELEVENLABS_VOICE_<HOST>.
function voiceIdFor(host: Host): string {
  const fromEnv = process.env[`ELEVENLABS_VOICE_${host.toUpperCase()}`]
  if (fromEnv) return fromEnv
  const defaults: Record<Host, string> = {
    ginger: 'hROPTUoViDvDwonZteKF',
    ahnika: 'v0r5L5uDA6ocN9hjTPYK',
    laviche: 'oNYzGfXKQJfjG1yEuJe9',
  }
  return defaults[host]
}

// Turbo v2.5 is multilingual, low-latency, and the cheaper ElevenLabs
// model — right tradeoff for short, frequent concierge replies (and it
// handles Spanish place names like Tenerife / Santa Cruz cleanly).
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5'

const MAX_TTS_CHARS = 2000

export async function OPTIONS(req: Request) {
  return preflight(req)
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null

  const host = body?.host
  if (host !== 'laviche' && host !== 'ginger' && host !== 'ahnika') {
    return jsonWithCors({ error: 'Unknown host.' }, { status: 400, request: req })
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return jsonWithCors({ error: 'Nothing to speak.' }, { status: 400, request: req })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    // Soft-fail so the UI can hide voice controls instead of erroring.
    return jsonWithCors(
      { error: 'Voice is not configured.', code: 'not_configured' },
      { status: 503, request: req }
    )
  }

  // Cap length to protect cost; concierge replies are short anyway.
  const speakText = text.length > MAX_TTS_CHARS ? text.slice(0, MAX_TTS_CHARS) : text
  const voiceId = voiceIdFor(host)

  try {
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: speakText,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!elevenRes.ok) {
      const detail = await elevenRes.text().catch(() => '')
      console.error('[speak] ElevenLabs error', elevenRes.status, detail.slice(0, 500))
      return jsonWithCors(
        { error: 'Voice service failed.', status: elevenRes.status },
        { status: 502, request: req }
      )
    }

    const audio = await elevenRes.arrayBuffer()

    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        ...corsHeaders(req.headers.get('origin')),
      },
    })
  } catch (err) {
    console.error('[speak] request failed', err)
    return jsonWithCors({ error: 'Voice request failed.' }, { status: 500, request: req })
  }
}
