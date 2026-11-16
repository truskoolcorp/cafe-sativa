import { NextResponse } from 'next/server'
import { publicChatReadiness } from '@/lib/content/public-chat-attestation-runtime'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function GET(request: Request) {
  const result = await publicChatReadiness(request.signal)
  return NextResponse.json(result.body, { status: result.status, headers: {
    'Cache-Control': 'no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}
