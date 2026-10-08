import { NextRequest } from 'next/server'
import { processContent } from '@/lib/content/worker'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req: NextRequest) { return processContent(req) }
