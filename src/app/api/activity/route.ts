import { NextResponse } from 'next/server'

const WALLET = '0xee54054e091913A542e7104d59EccEFBf982DDCF'

export async function GET() {
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/activity?user=${WALLET}&limit=500`,
      { cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json([], { status: res.status })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json([], { status: 500 })
  }
}
