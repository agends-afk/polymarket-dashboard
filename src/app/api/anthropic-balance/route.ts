import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key configured' }, { status: 500 })
    }

    const res = await fetch('https://api.anthropic.com/v1/organizations/billing', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })

    if (!res.ok) {
      // Billing endpoint may not be public — return graceful fallback
      return NextResponse.json({ balance: null, error: 'Billing API unavailable' })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ balance: null, error: 'Failed to fetch balance' })
  }
}
