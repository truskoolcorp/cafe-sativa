import { Resend } from 'resend'

/**
 * Resend client + shared send primitive.
 *
 * Design: email is always fire-and-forget from the caller's POV.
 * If RESEND_API_KEY isn't set, or the send fails, we log and
 * return — never throw. Order writes, contact form submissions,
 * etc., should succeed even if email delivery is broken.
 *
 * From-address rules:
 *   - FROM_ADDRESS env var overrides if set
 *   - Otherwise defaults to 'Café Sativa <hello@cafe-sativa.com>'
 *   - Requires cafe-sativa.com to be a verified sending domain
 *     in Resend; if it isn't, sends will bounce with a 403.
 *
 * Debug: set EMAIL_DEBUG=1 in env to log full payloads (don't in prod,
 * leaks customer emails to the log).
 */

const DEFAULT_FROM = 'Café Sativa <hello@cafe-sativa.com>'

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: string }

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping send', {
      to,
      subject,
    })
    return { ok: false, reason: 'not_configured' }
  }

  if (!to || (Array.isArray(to) && to.length === 0)) {
    return { ok: false, reason: 'no_recipient' }
  }

  const from = process.env.EMAIL_FROM_ADDRESS || DEFAULT_FROM
  const resend = new Resend(apiKey)

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      replyTo,
    })

    if (result.error) {
      console.error('[email] Resend error:', result.error)
      return { ok: false, reason: result.error.message ?? 'send_failed' }
    }

    if (process.env.EMAIL_DEBUG === '1') {
      console.log('[email] sent', { to, subject, id: result.data?.id })
    }

    return { ok: true, id: result.data?.id ?? '' }
  } catch (err: any) {
    console.error('[email] send threw', err)
    return { ok: false, reason: err?.message || 'threw' }
  }
}
