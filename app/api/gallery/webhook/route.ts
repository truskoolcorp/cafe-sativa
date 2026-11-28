// Sandbox only. Shared handler enforces exact ingress, isolation and event mode.
import { POST as handleStripeEvent } from '@/app/api/webhooks/stripe/route'
export const runtime = 'nodejs'
export async function POST(req: Request) {
  return handleStripeEvent(req)
}
