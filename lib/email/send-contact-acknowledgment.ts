import { sendEmail, type SendResult } from './send'

/**
 * Contact-form acknowledgment email. Sent to the submitter so they
 * know the message landed. Deliberately light — no "we'll respond
 * within 24 hours" promise we can't keep.
 *
 * For internal routing, the /api/contact route also sends a copy
 * to CONTACT_FORWARD_TO (set in env) so we get pinged. That send
 * happens separately.
 */

type Params = {
  to: string
  name: string
  topic: string
  originalMessage: string
}

function topicLabel(topic: string): string {
  const map: Record<string, string> = {
    general: 'General inquiry',
    artist: 'Artist submission',
    press: 'Press / media',
    booking: 'Event booking',
    partnership: 'Partnership',
  }
  return map[topic] || 'General inquiry'
}

export async function sendContactAcknowledgment(
  params: Params
): Promise<SendResult> {
  if (!params.to) return { ok: false, reason: 'no_recipient' }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com'

  const subject = `We got your message — Café Sativa`

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0604;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0604">
    <tr>
      <td align="center" style="padding:40px 16px">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#1a0f08;border:1px solid #3a2a1f;border-radius:12px;overflow:hidden">
          <tr>
            <td style="padding:32px 32px 0">
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;color:#c29355;letter-spacing:0.5px">Café Sativa</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px">
              <h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#f1e5d1;font-weight:700">
                Hey ${params.name.split(' ')[0] || 'there'} — we got your message.
              </h2>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#f1e5d1">
                You reached us about <strong style="color:#c29355">${topicLabel(params.topic)}</strong>.
                Someone on the team will get back to you soon.
              </p>

              <div style="background:#0f0805;border-left:3px solid #c29355;padding:16px 20px;margin:24px 0;border-radius:4px">
                <p style="margin:0 0 6px;font-size:12px;color:#8a7a68;text-transform:uppercase;letter-spacing:1px;font-weight:600">Your message</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#b8a589;white-space:pre-wrap">${escapeHtml(params.originalMessage)}</p>
              </div>

              <p style="margin:24px 0 0;font-size:13px;color:#b8a589;line-height:1.6">
                In the meantime, you might enjoy poking around the
                <a href="${siteUrl}/events" style="color:#c29355;text-decoration:underline">events schedule</a>
                or having a chat with one of our
                <a href="${siteUrl}/ask" style="color:#c29355;text-decoration:underline">hosts</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px;border-top:1px solid #3a2a1f">
              <p style="margin:0;font-size:12px;color:#8a7a68;line-height:1.5">
                Café Sativa — Where Nordic wellness meets Canary Island culture.<br>
                Virtual venue now. Physical doors opening in Tenerife, Spain, 2026.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = `Hey ${params.name.split(' ')[0] || 'there'} — we got your message.

You reached us about ${topicLabel(params.topic)}. Someone on the team will get back to you soon.

Your message:
${params.originalMessage}

In the meantime, browse the events: ${siteUrl}/events
Or chat with a host: ${siteUrl}/ask

Café Sativa`

  return sendEmail({
    to: params.to,
    subject,
    html,
    text,
    replyTo: process.env.CONTACT_REPLY_TO || undefined,
  })
}

// Minimal HTML escape to stop user-supplied message content from breaking out
// of the <p> block or injecting markup in the email body.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
