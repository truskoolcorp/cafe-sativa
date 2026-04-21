import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

/**
 * GET /api/concierge-verify
 *
 * Diagnostic endpoint for the concierge pipeline. Reports which env
 * vars are set (as booleans — never the values), and if ANTHROPIC_API_KEY
 * IS set, does a minimal smoke-test call to prove the key actually works.
 *
 * Response shape:
 *   {
 *     env: {
 *       ANTHROPIC_API_KEY: boolean,
 *       SUPABASE_SERVICE_ROLE_KEY: boolean,
 *       CONCIERGE_DEBUG: boolean
 *     },
 *     anthropic_check: {
 *       ok: boolean,
 *       status?: number,
 *       error_type?: string,
 *       error_message?: string,     // only if ?verbose=1
 *       model?: string,
 *       request_id?: string
 *     }
 *   }
 *
 * Safe to leave deployed. It never echoes key material or prompts;
 * it only asks Anthropic to reply 'ok' and reports how that call went.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const verbose = url.searchParams.get('verbose') === '1'

  const envReport = {
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    CONCIERGE_DEBUG: process.env.CONCIERGE_DEBUG === '1',
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      env: envReport,
      anthropic_check: {
        ok: false,
        error_type: 'missing_key',
        error_message: verbose ? 'ANTHROPIC_API_KEY is not set in env.' : undefined,
      },
    })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with a single word: ok.' }],
    })

    const text = completion.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    return NextResponse.json({
      env: envReport,
      anthropic_check: {
        ok: true,
        model: completion.model,
        stop_reason: completion.stop_reason,
        reply: text.slice(0, 100),
      },
    })
  } catch (err: any) {
    return NextResponse.json({
      env: envReport,
      anthropic_check: {
        ok: false,
        status: err?.status ?? null,
        error_type: err?.error?.type || 'unknown',
        error_message: verbose ? err?.error?.message || err?.message || null : undefined,
        request_id: err?.headers?.['request-id'] || null,
        // Include the error class name — helps distinguish SDK-layer
        // errors (JSON parse, TypeError) from API-layer errors.
        error_class: err?.constructor?.name ?? null,
        raw: verbose ? (err?.toString?.() || String(err)) : undefined,
      },
    })
  }
}
