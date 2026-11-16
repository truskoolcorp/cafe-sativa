import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { processContent } from '@/lib/content/worker'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(req: NextRequest) {
  if (!await isContentAdmin()) return NextResponse.json({error:'Unauthorized'}, {status:401})
  if (req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({error:'Invalid origin'}, {status:403})
  const key = process.env.RUNWAYML_API_SECRET, secret = process.env.CRON_SECRET
  if (!key || !secret) return NextResponse.json({error:'Runway credential or worker authorization missing'}, {status:503})
  try {
    const check = await fetch('https://api.dev.runwayml.com/v1/organization', {headers:{Authorization:`Bearer ${key}`, 'X-Runway-Version':'2024-11-06'}, signal:AbortSignal.timeout(10000), cache:'no-store'})
    if (!check.ok) return NextResponse.json({error:'Runway authentication check failed', providerStatus:check.status}, {status:503})
    return await processContent(new NextRequest(req.url, {headers:{authorization:`Bearer ${secret}`}}), true)
  } catch { return NextResponse.json({error:'Runway preflight timed out or unavailable; no submission attempted'}, {status:503}) }
}
