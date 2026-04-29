import { NextResponse } from 'next/server'

const WALLET = '0xee54054e091913A542e7104d59EccEFBf982DDCF'

export async function GET() {
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/positions?user=${WALLET}&sizeThreshold=0`,
      { cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json([], { status: res.status })
    const data = await res.json()

    // Return all positions including resolved (curPrice 0 or 1) so consumers
    // can attribute P&L correctly. Display filters live in the dashboard.
    const withSize = (data || []).filter((p: any) => parseFloat(p.size || 0) > 0)
    return NextResponse.json(withSize)
  } catch {
    return NextResponse.json([], { status: 500 })
  }
}
