import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

interface TicketConfirmationParams {
  to: string
  eventTitle: string
  eventSubtitle?: string | null
  startsAt: string          // ISO string
  zoomJoinUrl: string       // from events.zoom_join_url
  eventSlug: string
  amountPaidCents: number
  presenterName?: string | null
}

function formatEventDate(iso: string) {
  const d = new Date(iso)
  const TZ = 'America/Chicago'
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: TZ }),
    date: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: TZ }),
  }
}

export async function sendTicketConfirmation(params: TicketConfirmationParams) {
  const { to, eventTitle, eventSubtitle, startsAt, zoomJoinUrl, eventSlug, amountPaidCents, presenterName } = params
  const when = formatEventDate(startsAt)
  const priceLabel = amountPaidCents === 0 ? 'Complimentary' : `$${(amountPaidCents / 100).toFixed(2)}`
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://cafe-sativa.com'
  const eventUrl = `${siteUrl}/events/${eventSlug}`
  const watchUrl = `${siteUrl}/events/${eventSlug}/watch`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0a07;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0a07;min-height:100vh;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1c1409;border-radius:12px;border:1px solid #2e1f0e;overflow:hidden;">
        
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#b8813a,#c9826b);padding:32px 40px;">
          <p style="margin:0;color:#0d0a07;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Café Sativa</p>
          <h1 style="margin:8px 0 0;color:#0d0a07;font-size:24px;font-weight:700;line-height:1.2;">You're in. 🌿</h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <h2 style="margin:0 0 4px;color:#e8ddd0;font-size:20px;font-weight:700;">${eventTitle}</h2>
          ${eventSubtitle ? `<p style="margin:0 0 24px;color:#9e8870;font-size:14px;">${eventSubtitle}</p>` : '<div style="margin-bottom:24px;"></div>'}

          <!-- Event details -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2e1f0e;border-radius:8px;overflow:hidden;margin-bottom:28px;">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #2e1f0e;">
                <p style="margin:0 0 4px;color:#6b5540;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Date</p>
                <p style="margin:0;color:#e8ddd0;font-size:14px;font-weight:600;">${when.weekday}, ${when.date}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #2e1f0e;">
                <p style="margin:0 0 4px;color:#6b5540;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Time</p>
                <p style="margin:0;color:#e8ddd0;font-size:14px;font-weight:600;">${when.time}</p>
              </td>
            </tr>
            ${presenterName ? `
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #2e1f0e;">
                <p style="margin:0 0 4px;color:#6b5540;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">With</p>
                <p style="margin:0;color:#e8ddd0;font-size:14px;font-weight:600;">${presenterName}</p>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0 0 4px;color:#6b5540;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Ticket</p>
                <p style="margin:0;color:#e8ddd0;font-size:14px;font-weight:600;">${priceLabel}</p>
              </td>
            </tr>
          </table>

          <!-- Join button -->
          <p style="margin:0 0 12px;color:#9e8870;font-size:13px;">When the event starts, join here:</p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#b8813a;border-radius:6px;">
              <a href="${watchUrl}" style="display:inline-block;padding:14px 28px;color:#0d0a07;font-size:14px;font-weight:700;text-decoration:none;">Join Event →</a>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;color:#6b5540;font-size:12px;">Or join directly via Zoom:</p>
          <a href="${zoomJoinUrl}" style="color:#b8813a;font-size:12px;word-break:break-all;">${zoomJoinUrl}</a>

          <hr style="border:none;border-top:1px solid #2e1f0e;margin:28px 0;">
          <p style="margin:0;color:#6b5540;font-size:12px;line-height:1.6;">This link is unique to your ticket. Please don't share it publicly. Questions? Reply to this email or visit <a href="${eventUrl}" style="color:#b8813a;">${eventUrl}</a>.</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 40px;border-top:1px solid #2e1f0e;">
          <p style="margin:0;color:#6b5540;font-size:11px;">Café Sativa · Sip. Smoke. Vibe. · <a href="${siteUrl}" style="color:#6b5540;">cafe-sativa.com</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  return resend.emails.send({
    from: 'Café Sativa <events@cafe-sativa.com>',
    to,
    subject: `You're in — ${eventTitle}`,
    html,
  })
}
