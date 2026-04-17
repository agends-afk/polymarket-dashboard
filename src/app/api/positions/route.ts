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

    // Filter out resolved positions: price at 0 or 1 means settled
    const active = (data || []).filter((p: any) => {
      const size = parseFloat(p.size || 0)
      const price = parseFloat(p.curPrice || 0)
      if (size <= 0) return false
      if (price <= 0.005 || price >= 0.995) return false
      return true
    })

    return NextResponse.json(active)
  } catch {
    return NextResponse.json([], { status: 500 })
  }
}
