import { NextResponse } from 'next/server'
import { approvedVenueCovers } from '@/lib/content/venue-covers'
export const dynamic='force-dynamic'
export async function GET() {
  return NextResponse.json({covers:await approvedVenueCovers()},{headers:{'Cache-Control':'no-store'}})
}
