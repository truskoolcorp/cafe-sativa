import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/host/avatar-speak
 *
 * Sends text to HeyGen Interactive Avatar API to trigger lip-sync.
 * The avatar must already be in an active streaming session (started
 * via HeyGen's createStreamingAvatar SDK on the client or OBS side).
 *
 * Body: { text: string, avatarId: string, sessionId?: string }
 * Response: { ok: boolean, taskId?: string }
 *
 * HeyGen Interactive Avatar docs:
 *   https://docs.heygen.com/reference/new-session-v1
 *   https://docs.heygen.com/reference/submit-task-v1
 *
 * Session lifecycle (managed externally, e.g. OBS browser source):
 *   1. POST /v1/streaming.new       → get session_id + access_token
 *   2. ICE/WebRTC connect
 *   3. POST /v1/streaming.task      → send speak tasks  ▒ this route
 *   4. POST /v1/streaming.stop      → end session
 */
export async function POST(req: NextRequest) {
  try {
    const { text, avatarId, sessionId } = await req.json()

    if (!text || !avatarId) {
      return NextResponse.json({ error: 'Missing text or avatarId' }, { status: 400 })
    }

    const apiKey = process.env.HEYGEN_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'HEYGEN_API_KEY not configured' }, { status: 500 })
    }

    // If no active sessionId provided, create a new one
    // In production, sessionId is persisted in memory/Redis between calls
    const activeSessionId = sessionId ?? await createHeyGenSession(apiKey, avatarId)

    if (!activeSessionId) {
      return NextResponse.json({ error: 'Could not start HeyGen session' }, { status: 502 })
    }

    // Submit speak task
    const taskRes = await fetch('https://api.heygen.com/v1/streaming.task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        session_id: activeSessionId,
        text,
        task_type: 'talk',
      }),
    })

    if (!taskRes.ok) {
      const err = await taskRes.text()
      console.error('HeyGen task error:', err)
      return NextResponse.json({ error: 'HeyGen task error', detail: err }, { status: 502 })
    }

    const taskData = await taskRes.json()
    return NextResponse.json({ ok: true, taskId: taskData?.data?.task_id, sessionId: activeSessionId })

  } catch (err) {
    console.error('/api/host/avatar-speak error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Create a new HeyGen streaming session for the given avatar.
 * Returns the session_id string, or null on failure.
 *
 * Note: In production this should be called once and the session_id
 * stored in a server-side cache (e.g. Redis, in-memory Map) keyed by
 * avatarId so each avatar has exactly one long-lived session per show.
 */
async function createHeyGenSession(apiKey: string, avatarId: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.heygen.com/v1/streaming.new', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        avatar_id: avatarId,
        quality: 'high',
        voice: { rate: 1.0, emotion: 'Friendly' },
        video_encoding: 'H264',
        disable_idle_timeout: true,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.data?.session_id ?? null
  } catch {
    return null
  }
}
