import { NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'

export const dynamic='force-dynamic'
// Configuration inspection is read-only. Never invoke a paid provider on GET.
export async function GET() {
  if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
  return NextResponse.json({configured:{
    brain:Boolean(process.env.ANTHROPIC_API_KEY),
    memory:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  }},{headers:{'Cache-Control':'private, no-store'}})
}
