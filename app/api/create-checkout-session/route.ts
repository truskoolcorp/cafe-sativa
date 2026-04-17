import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    error: 'Stripe not configured yet'
  }, { status: 500 })
}
