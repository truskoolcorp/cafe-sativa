import { NextResponse } from 'next/server'

// Fail closed until authenticated server-side ticket/membership verification
// has passed an isolated access-control rehearsal.
export async function GET() {
  return NextResponse.json({ error: 'Event joining is temporarily unavailable.' }, {
    status: 503,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
