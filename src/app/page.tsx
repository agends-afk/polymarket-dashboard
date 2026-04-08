'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const WALLET = '0xee54054e091913A542e7104d59EccEFBf982DDCF'

/* ── Types ── */

interface Cycle {
  id: number
  created_at: string
  markets_scanned: number
  opportunities_found: number
  bets_placed: number
  bankroll_usdc: number
  pnl_usdc: number
  roi_pct: number
  wins: number
  losses: number
  pending: number
  cost_per_cycle_usd: number
  dry_run: boolean
  top_opportunities: Opportunity[]
}

interface Opportunity {
  question: string
  category: string
  direction: string
  market_price: number
  our_prob: number
  edge: number
  bet_size: number
  score: number
  url: string
}

interface LivePosition {
  conditionId: string
  title: string
  outcome: string
  currentValue: number
  initialValue: number
  pnl: number
  pnlPct: number
  size: number
  currentPrice: number
  entryPrice: number
  endDate: string
  url: string
}

interface OpenOrder {
  id: string
  market_id: string
  question: string
  direction: string
  price: number
  original_size: number
  size_matched: number
  size_remaining: number
  expiration: number | null
  order_type: string
  status: string
}

interface TradeRecord {
  conditionId: string
  title: string
  outcome: string
  url: string
  buys: number
  sells: number
  costUsdc: number
  proceedsUsdc: number
  pnl: number
  status: 'WIN' | 'LOSS' | 'OPEN' | 'PULLED'
  lastActivity: number
}

/* ── Data fetchers ── */

async function fetchLivePositions(): Promise<LivePosition[]> {
  try {
    const res = await fetch(`https://data-api.polymarket.com/positions?user=${WALLET}&sizeThreshold=0`)
    if (!res.ok) return []
    const data = await res.json()
    return (data || []).map((p: any) => {
      const size = parseFloat(p.size || 0)
      const currentPrice = parseFloat(p.curPrice || p.currentPrice || 0)
      const avgPrice = parseFloat(p.avgPrice || 0)
      const currentValue = size * currentPrice
      const initialValue = size * avgPrice
      const pnl = currentValue - initialValue
      const pnlPct = initialValue > 0 ? (pnl / initialValue) * 100 : 0
      return {
        conditionId: p.conditionId || '',
        title: p.title || '',
        outcome: p.outcome || '',
        currentValue,
        initialValue,
        pnl,
        pnlPct,
        size,
        currentPrice,
        entryPrice: avgPrice,
        endDate: p.endDate || '',
        url: p.slug ? `https://polymarket.com/event/${p.slug}` : '',
      }
    }).filter((p: LivePosition) => p.size > 0 && !(p.currentPrice === 0 && new Date(p.endDate) < new Date()))
  } catch {
    return []
  }
}

async function fetchTradeHistory(): Promise<TradeRecord[]> {
  try {
    const res = await fetch(`https://data-api.polymarket.com/activity?user=${WALLET}&limit=500`)
    if (!res.ok) return []
    const data = await res.json()

    const grouped: Record<string, any[]> = {}
    for (const d of data) {
      if (!grouped[d.conditionId]) grouped[d.conditionId] = []
      grouped[d.conditionId].push(d)
    }

    const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${WALLET}&sizeThreshold=0`)
    const posData = posRes.ok ? await posRes.json() : []
    const openConditionIds = new Set(
      posData.filter((p: any) => parseFloat(p.curPrice) > 0).map((p: any) => p.conditionId)
    )

    return Object.entries(grouped).map(([conditionId, trades]) => {
      const buys = trades.filter(t => t.side === 'BUY')
      const sells = trades.filter(t => t.side === 'SELL')
      const costUsdc = buys.reduce((s: number, t: any) => s + t.usdcSize, 0)
      const proceedsUsdc = sells.reduce((s: number, t: any) => s + t.usdcSize, 0)
      const pnl = proceedsUsdc - costUsdc
      const lastActivity = Math.max(...trades.map(t => t.timestamp))
      const sample = trades[0]

      let status: TradeRecord['status']
      if (openConditionIds.has(conditionId)) status = 'OPEN'
      else if (sells.length === 0) status = 'PULLED'
      else if (pnl >= 0) status = 'WIN'
      else status = 'LOSS'

      return {
        conditionId,
        title: sample.title || '',
        outcome: sample.outcome || '',
        url: sample.slug ? `https://polymarket.com/event/${sample.slug}` : '',
        buys: buys.length,
        sells: sells.length,
        costUsdc,
        proceedsUsdc,
        pnl,
        status,
        lastActivity,
      }
    })
    .filter(t => !(t.status === 'PULLED' && t.costUsdc === 0))
    .sort((a, b) => b.lastActivity - a.lastActivity)
  } catch {
    return []
  }
}

/* ── Helpers ── */

function fmt(n: number, dec = 2) { return (n ?? 0).toFixed(dec) }
function fmtPct(n: number) { return `${n >= 0 ? '+' : ''}${fmt(n, 1)}%` }

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function expiresIn(ts: number) {
  const diff = Math.max(0, ts - Date.now() / 1000)
  if (diff <= 0) return 'Expired'
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/* ── Sparkline component ── */

function Sparkline({ data, color, height = 40 }: { data: number[], color: string, height?: number }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 200
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  )
}

/* ── Dashboard ── */

export default function Dashboard() {
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [livePositions, setLivePositions] = useState<LivePosition[]>([])
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([])
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)

    const [
      { data: cyclesData },
      { data: ordersData },
      { data: balanceData },
      positions,
      trades,
    ] = await Promise.all([
      supabase.from('cycles').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('orders').select('*').order('expiration', { ascending: true }),
      supabase.from('balance').select('usdc').eq('id', 1).single(),
      fetchLivePositions(),
      fetchTradeHistory(),
    ])

    if (cyclesData) setCycles(cyclesData)
    if (ordersData) setOpenOrders(ordersData)
    if (balanceData?.usdc) setUsdcBalance(balanceData.usdc)
    setLivePositions(positions)
    setTradeHistory(trades)
    setLastRefresh(new Date())
    setLoading(false)
    if (isManual) setRefreshing(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => fetchData(), 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  /* ── Derived data ── */
  const latest = cycles[0]
  const isLive = latest && !latest.dry_run

  // Portfolio
  const totalUnrealisedPnL = livePositions.reduce((s, p) => s + p.pnl, 0)
  const totalPositionValue = livePositions.reduce((s, p) => s + p.currentValue, 0)
  const totalInvested = livePositions.reduce((s, p) => s + p.initialValue, 0)
  const displayBalance = usdcBalance ?? latest?.bankroll_usdc ?? 0
  const portfolioValue = displayBalance + totalPositionValue

  // Trade stats
  const wins = tradeHistory.filter(t => t.status === 'WIN').length
  const losses = tradeHistory.filter(t => t.status === 'LOSS').length
  const realWinRate = (wins + losses) > 0 ? (wins / (wins + losses) * 100) : null
  const realisedPnL = tradeHistory.filter(t => t.status !== 'OPEN').reduce((s, t) => s + t.pnl, 0)
  const totalPnL = realisedPnL + totalUnrealisedPnL

  // Costs
  const totalCost = cycles.reduce((s, c) => s + (c.cost_per_cycle_usd || 0), 0)

  // Sparkline data (portfolio value over time, oldest first)
  const sparkData = [...cycles].reverse().map(c => c.bankroll_usdc).filter(v => v > 0)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="live-dot" style={{ margin: '0 auto 12px' }} />
          <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.15em' }}>LOADING</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.25em', color: 'var(--muted)', marginBottom: 4 }}>
            PROPHET MARGIN
          </div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Polymarket Bot</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 8, padding: '7px 14px',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
              cursor: refreshing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              opacity: refreshing ? 0.6 : 1, transition: 'opacity 0.2s',
            }}
          >
            <span style={{ fontSize: 13 }}>{refreshing ? '...' : 'REFRESH'}</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="live-dot" />
            <span className={`tag ${isLive ? 'live' : 'dry'}`}>{isLive ? 'LIVE' : 'DRY RUN'}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
            {timeAgo(lastRefresh.toISOString())}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>

        {/* Portfolio Value */}
        <div className="card">
          <div className="card-header">Portfolio Value</div>
          <div className={`big-number ${totalPnL >= 0 ? 'positive' : 'negative'}`}>
            ${fmt(portfolioValue)}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
            ${fmt(displayBalance)} cash + ${fmt(totalPositionValue)} positions
          </div>
          {sparkData.length > 3 && (
            <div style={{ marginTop: 10 }}>
              <Sparkline data={sparkData} color={totalPnL >= 0 ? '#7fff7f' : '#ff7f7f'} height={36} />
            </div>
          )}
        </div>

        {/* Total P&L */}
        <div className="card">
          <div className="card-header">Total P&L</div>
          <div className={`big-number ${totalPnL >= 0 ? 'positive' : 'negative'}`}>
            {totalPnL >= 0 ? '+' : ''}${fmt(totalPnL)}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
            <span style={{ color: realisedPnL >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
              {realisedPnL >= 0 ? '+' : ''}${fmt(realisedPnL)} realised
            </span>
            {' / '}
            <span style={{ color: totalUnrealisedPnL >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
              {totalUnrealisedPnL >= 0 ? '+' : ''}${fmt(totalUnrealisedPnL)} unrealised
            </span>
          </div>
        </div>

        {/* Win Rate */}
        <div className="card">
          <div className="card-header">Win Rate</div>
          <div className={`big-number ${realWinRate !== null && realWinRate >= 50 ? 'positive' : realWinRate !== null ? 'negative' : 'neutral'}`}>
            {realWinRate !== null ? `${fmt(realWinRate, 0)}%` : '--'}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
            {wins}W / {losses}L / {livePositions.length} open
          </div>
        </div>

        {/* Bot Stats */}
        <div className="card">
          <div className="card-header">Bot Stats</div>
          <div className="big-number neutral">
            {livePositions.length} <span style={{ fontSize: 16, color: 'var(--muted)' }}>pos</span>
            {' '}<span style={{ fontSize: 16, color: 'var(--muted)' }}>/</span>{' '}
            {openOrders.length} <span style={{ fontSize: 16, color: 'var(--muted)' }}>ord</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
            Cost: ${fmt(totalCost)} total ({cycles.length} cycles)
          </div>
        </div>

      </div>

      {/* Last Cycle + Opportunities */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="card-header">Last Cycle</div>
          {latest ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="mono" style={{ fontSize: 13 }}>{timeAgo(latest.created_at)}</div>
                <span className={`tag ${latest.dry_run ? 'dry' : 'live'}`}>{latest.dry_run ? 'DRY' : 'LIVE'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {([
                  ['Scanned', latest.markets_scanned],
                  ['Opportunities', latest.opportunities_found],
                  ['Bets Placed', latest.bets_placed],
                  ['Cycle Cost', `$${fmt(latest.cost_per_cycle_usd, 3)}`],
                  ['Portfolio', `$${fmt(latest.bankroll_usdc)}`],
                  ['ROI', fmtPct(latest.roi_pct ?? 0)],
                ] as [string, string | number][]).map(([label, value]) => (
                  <div key={label} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 4 }}>
                      {String(label).toUpperCase()}
                    </div>
                    <div className="mono" style={{ fontSize: 14 }}>{value}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No cycles recorded yet</div>
          )}
        </div>

        <div className="card">
          <div className="card-header">Latest Opportunities</div>
          {(latest?.top_opportunities?.length ?? 0) > 0 ? (
            <div className="scroll-area" style={{ maxHeight: 220 }}>
              {latest.top_opportunities.map((opp, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: i < latest.top_opportunities.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                    <span className={`tag ${opp.direction.toLowerCase()}`}>{opp.direction}</span>
                    <a href={opp.url} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text)', textDecoration: 'none' }}>
                      {opp.question}
                    </a>
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 12 }}>
                    <span>@ {fmt(opp.market_price * 100, 1)}c</span>
                    <span>prob {fmt(opp.our_prob * 100, 1)}%</span>
                    <span style={{ color: 'var(--accent)' }}>edge {fmt(opp.edge * 100, 1)}%</span>
                    <span>bet ${fmt(opp.bet_size)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No opportunities in last cycle</div>
          )}
        </div>
      </div>

      {/* Live Positions */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header">
          Live Positions ({livePositions.length})
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
            live from Polymarket
          </span>
        </div>
        {livePositions.length > 0 ? (
          <div className="scroll-area">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Market', 'Side', 'Shares', 'Entry', 'Now', 'Value', 'P&L', 'P&L %'].map(h => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {livePositions
                  .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
                  .map((pos, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="td" style={{ maxWidth: 280 }}>
                      <a href={pos.url} target="_blank" rel="noopener noreferrer"
                         style={{ fontSize: 12, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4 }}>
                        {pos.title || pos.conditionId.slice(0, 24) + '...'}
                      </a>
                    </td>
                    <td className="td">
                      <span className={`tag ${pos.outcome.toLowerCase() === 'yes' ? 'yes' : 'no'}`}>
                        {pos.outcome}
                      </span>
                    </td>
                    <td className="td mono-cell">{fmt(pos.size, 1)}</td>
                    <td className="td mono-cell">{fmt(pos.entryPrice * 100, 1)}c</td>
                    <td className="td mono-cell">{fmt(pos.currentPrice * 100, 1)}c</td>
                    <td className="td mono-cell">${fmt(pos.currentValue)}</td>
                    <td className="td mono-cell" style={{ color: pos.pnl >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                      {pos.pnl >= 0 ? '+' : ''}${fmt(pos.pnl)}
                    </td>
                    <td className="td mono-cell" style={{ color: pos.pnlPct >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                      {fmtPct(pos.pnlPct)}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="td" style={{ fontWeight: 700, fontSize: 11, color: 'var(--muted)' }}>TOTAL</td>
                  <td className="td"></td>
                  <td className="td"></td>
                  <td className="td"></td>
                  <td className="td"></td>
                  <td className="td mono-cell" style={{ fontWeight: 700 }}>${fmt(totalPositionValue)}</td>
                  <td className="td mono-cell" style={{ fontWeight: 700, color: totalUnrealisedPnL >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                    {totalUnrealisedPnL >= 0 ? '+' : ''}${fmt(totalUnrealisedPnL)}
                  </td>
                  <td className="td mono-cell" style={{ fontWeight: 700, color: totalUnrealisedPnL >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                    {totalInvested > 0 ? fmtPct((totalUnrealisedPnL / totalInvested) * 100) : '--'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No live positions</div>
        )}
      </div>

      {/* Unfilled Orders */}
      {openOrders.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">
            Pending Orders ({openOrders.length})
          </div>
          <div className="scroll-area">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Market', 'Side', 'Price', 'Size', 'Filled', 'Remaining', 'Expires'].map(h => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openOrders.map((order) => (
                  <tr key={order.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="td" style={{ maxWidth: 280, fontSize: 12 }}>
                      {order.question || order.id.slice(0, 18) + '...'}
                    </td>
                    <td className="td">
                      <span className={`tag ${order.direction.toLowerCase() === 'yes' ? 'yes' : 'no'}`}>
                        {order.direction}
                      </span>
                    </td>
                    <td className="td mono-cell">{fmt(order.price * 100, 1)}c</td>
                    <td className="td mono-cell">${fmt(order.original_size)}</td>
                    <td className="td mono-cell" style={{ color: 'var(--accent)' }}>${fmt(order.size_matched)}</td>
                    <td className="td mono-cell">${fmt(order.size_remaining)}</td>
                    <td className="td mono-cell" style={{ color: 'var(--muted)', fontSize: 11 }}>
                      {order.expiration ? expiresIn(order.expiration) : 'GTC'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trade History */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header">
          Trade History ({tradeHistory.length})
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
            realised P&L:{' '}
            <span style={{ color: realisedPnL >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
              {realisedPnL >= 0 ? '+' : ''}${fmt(realisedPnL)}
            </span>
          </span>
        </div>
        {tradeHistory.length > 0 ? (
          <div className="scroll-area">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Market', 'Side', 'Cost', 'Proceeds', 'P&L', 'Status'].map(h => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeHistory.map((t) => (
                  <tr key={t.conditionId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="td" style={{ maxWidth: 280 }}>
                      <a href={t.url} target="_blank" rel="noopener noreferrer"
                         style={{ fontSize: 12, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4 }}>
                        {t.title}
                      </a>
                    </td>
                    <td className="td">
                      <span className={`tag ${t.outcome.toLowerCase() === 'yes' ? 'yes' : 'no'}`}>
                        {t.outcome}
                      </span>
                    </td>
                    <td className="td mono-cell">${fmt(t.costUsdc)}</td>
                    <td className="td mono-cell">${fmt(t.proceedsUsdc)}</td>
                    <td className="td mono-cell" style={{ color: t.pnl >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                      {t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}
                    </td>
                    <td className="td">
                      <span className={`tag ${t.status.toLowerCase()}`} style={{
                        color: t.status === 'WIN' ? 'var(--accent)' : t.status === 'LOSS' ? 'var(--accent3)' : t.status === 'PULLED' ? 'var(--accent2)' : 'var(--muted)'
                      }}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No trade history</div>
        )}
      </div>

      {/* Cycle History */}
      <div className="card">
        <div className="card-header">Cycle History ({cycles.length})</div>
        <div className="scroll-area">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Scanned', 'Opps', 'Bets', 'Portfolio', 'P&L', 'ROI', 'Cost'].map(h => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="td mono-cell" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{timeAgo(c.created_at)}</td>
                  <td className="td mono-cell">{c.markets_scanned}</td>
                  <td className="td mono-cell">{c.opportunities_found}</td>
                  <td className="td mono-cell">{c.bets_placed}</td>
                  <td className="td mono-cell">${fmt(c.bankroll_usdc)}</td>
                  <td className="td mono-cell" style={{ color: (c.pnl_usdc ?? 0) >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                    {(c.pnl_usdc ?? 0) >= 0 ? '+' : ''}${fmt(c.pnl_usdc ?? 0)}
                  </td>
                  <td className="td mono-cell" style={{ color: (c.roi_pct ?? 0) >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                    {fmtPct(c.roi_pct ?? 0)}
                  </td>
                  <td className="td mono-cell" style={{ color: 'var(--accent3)' }}>${fmt(c.cost_per_cycle_usd ?? 0, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
        PROPHET MARGIN / POSITIONS LIVE FROM POLYMARKET / ORDERS & CYCLES FROM SUPABASE / AUTO-REFRESH 60s
      </div>

    </div>
  )
}
