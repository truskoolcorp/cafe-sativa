import { NextRequest } from 'next/server'
import {processInternalCharacters} from '@/lib/content/character-production-internal-entry'
import { processContent } from '@/lib/content/worker'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req: NextRequest) { return process.env.CS_CHARACTER_INTERNAL_WORKER_ENABLED==='true'?processInternalCharacters(req):processContent(req) }

export async function POST(req: NextRequest) { return processContent(req,false,true) }
