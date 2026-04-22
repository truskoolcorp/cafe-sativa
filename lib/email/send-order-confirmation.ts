import { sendEmail, type SendResult } from './send'

/**
 * Order confirmation email.
 *
 * Two templates in one: physical orders get a "we'll ship it soon"
 * line, digital and NFT orders include the delivery URL directly so
 * the buyer can download immediately.
 *
 * Copy is plain, brand-neutral — this email competes with transactional
 * noise in the inbox and its job is to be readable, not stylish.
 */

type Params = {
  to: string
  orderId: string
  productTitle: string
  productKind: 'physical' | 'digital' | 'nft'
  priceCents: number
  quantity: number
  totalCents: number
  digitalDeliveryUrl: string | null
  fulfillmentState: string
}

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export async function sendOrderConfirmation(params: Params): Promise<SendResult> {
  if (!params.to) return { ok: false, reason: 'no_recipient' }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com'

  const subject = `Order confirmed — ${params.productTitle}`

  const isDigital =
    params.productKind === 'digital' || params.productKind === 'nft'

  const deliveryBlock = isDigital
    ? params.digitalDeliveryUrl
      ? `
        <p style="margin:24px 0 8px;font-size:14px;color:#c29355;letter-spacing:1px;text-transform:uppercase;font-weight:600">Your download</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#f1e5d1">
          <a href="${params.digitalDeliveryUrl}" style="color:#c29355;text-decoration:underline">
            ${params.digitalDeliveryUrl}
          </a>
        </p>
        <p style="margin:0 0 16px;font-size:13px;color:#b8a589">
          Save this link. You can also access it from your account page anytime.
        </p>
      `
      : `
        <p style="margin:24px 0 16px;font-size:15px;line-height:1.6;color:#f1e5d1">
          Your digital item is ready. We'll send the delivery details in a
          follow-up email within the hour.
        </p>
      `
    : `
        <p style="margin:24px 0 16px;font-size:15px;line-height:1.6;color:#f1e5d1">
          We'll package this carefully and ship it soon. You'll get a tracking
          email when it's on its way.
        </p>
      `

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
            <td style="padding:24px 32px">
              <h2 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#f1e5d1;font-weight:700">Order confirmed.</h2>
              <p style="margin:0 0 24px;font-size:14px;color:#b8a589">Order #${params.orderId.slice(0, 8)}</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #3a2a1f;border-bottom:1px solid #3a2a1f;padding:16px 0;margin:8px 0 16px">
                <tr>
                  <td style="padding:16px 0;font-size:15px;color:#f1e5d1;line-height:1.5">
                    <strong style="color:#f1e5d1;font-weight:600">${params.productTitle}</strong><br>
                    <span style="color:#b8a589;font-size:13px">Qty ${params.quantity} × ${formatUSD(params.priceCents)}</span>
                  </td>
                  <td style="padding:16px 0;text-align:right;font-size:15px;color:#f1e5d1">${formatUSD(params.priceCents * params.quantity)}</td>
                </tr>
                <tr>
                  <td style="padding:16px 0 0;font-size:13px;color:#b8a589;text-transform:uppercase;letter-spacing:1px;font-weight:600">Total</td>
                  <td style="padding:16px 0 0;text-align:right;font-size:20px;color:#c29355;font-weight:700">${formatUSD(params.totalCents)}</td>
                </tr>
              </table>

              ${deliveryBlock}

              <p style="margin:32px 0 8px;font-size:13px;color:#b8a589">
                Every purchase supports the artist directly. Thank you for that.
              </p>
              <p style="margin:0;font-size:13px">
                <a href="${siteUrl}/account" style="color:#c29355;text-decoration:underline">View your orders</a>
                &nbsp;•&nbsp;
                <a href="${siteUrl}/contact" style="color:#c29355;text-decoration:underline">Contact us</a>
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

  const text = `Order confirmed.

Order #${params.orderId.slice(0, 8)}

${params.productTitle}
Qty ${params.quantity} × ${formatUSD(params.priceCents)}

Total: ${formatUSD(params.totalCents)}

${
  isDigital
    ? params.digitalDeliveryUrl
      ? `Download: ${params.digitalDeliveryUrl}`
      : `We'll send the download details in a follow-up email within the hour.`
    : `We'll package this carefully and ship it soon. You'll get a tracking email when it's on its way.`
}

Every purchase supports the artist directly. Thank you for that.

View your orders: ${siteUrl}/account
Contact us: ${siteUrl}/contact

Café Sativa`

  return sendEmail({
    to: params.to,
    subject,
    html,
    text,
  })
}
