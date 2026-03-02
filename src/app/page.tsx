'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const WALLET = '0xee54054e091913A542e7104d59EccEFBf982DDCF'

interface Cycle {
  id: number
  created_at: string
  markets_scanned: number
  markets_evaluated: number
  opportunities_found: number
  bets_placed: number
  open_positions: number
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

async function fetchTradeHistory(): Promise<TradeRecord[]> {
  try {
    const res = await fetch(`https://data-api.polymarket.com/activity?user=${WALLET}&limit=500`)
    if (!res.ok) return []
    const data = await res.json()

    // Group by conditionId
    const grouped: Record<string, any[]> = {}
    for (const d of data) {
      if (!grouped[d.conditionId]) grouped[d.conditionId] = []
      grouped[d.conditionId].push(d)
    }

    // Get current open position conditionIds to determine status
    const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${WALLET}&sizeThreshold=0`)
    const posData = posRes.ok ? await posRes.json() : []
    const openConditionIds = new Set(posData.filter((p: any) => parseFloat(p.curPrice) > 0).map((p: any) => p.conditionId))

    return Object.entries(grouped).map(([conditionId, trades]) => {
      const buys = trades.filter(t => t.side === 'BUY')
      const sells = trades.filter(t => t.side === 'SELL')
      const costUsdc = buys.reduce((s: number, t: any) => s + t.usdcSize, 0)
      const proceedsUsdc = sells.reduce((s: number, t: any) => s + t.usdcSize, 0)
      const pnl = proceedsUsdc - costUsdc
      const lastActivity = Math.max(...trades.map(t => t.timestamp))
      const sample = trades[0]

      let status: TradeRecord['status']
      if (openConditionIds.has(conditionId)) {
        status = 'OPEN'
      } else if (sells.length === 0) {
        status = 'PULLED'
      } else if (pnl >= 0) {
        status = 'WIN'
      } else {
        status = 'LOSS'
      }

      // Filter out Trump/expired zero-value markets
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

function fmt(n: number, dec = 2) {
  return (n ?? 0).toFixed(dec)
}

function fmtPct(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${fmt(n, 1)}%`
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function nextCycleIn(iso: string, intervalMin = 480) {
  const next = new Date(iso).getTime() + intervalMin * 60 * 1000
  const diff = Math.max(0, (next - Date.now()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return `${h}h ${m}m`
}

function expiresIn(ts: number) {
  const diff = Math.max(0, ts - Date.now() / 1000)
  if (diff <= 0) return 'Expired'
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

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
        endDate: p.endDate || '',
        url: p.slug ? `https://polymarket.com/event/${p.slug}` : '',
      }
    }).filter((p: LivePosition) => p.size > 0 && !(p.currentPrice === 0 && new Date(p.endDate) < new Date()))
  } catch {
    return []
  }
}

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
      supabase.from('cycles').select('*').order('created_at', { ascending: false }).limit(50),
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

  const latest = cycles[0]
  const isLive = latest && !latest.dry_run
  const totalCost = cycles.reduce((s, c) => s + (c.cost_per_cycle_usd || 0), 0)
  const totalBets = cycles.reduce((s, c) => s + (c.bets_placed || 0), 0)
  const winRate = latest && (latest.wins + latest.losses) > 0
    ? (latest.wins / (latest.wins + latest.losses) * 100)
    : null

  const totalImpliedPnL = livePositions.reduce((s, p) => s + p.pnl, 0)
  const totalPositionValue = livePositions.reduce((s, p) => s + p.currentValue, 0)
  const totalInvested = livePositions.reduce((s, p) => s + p.initialValue, 0)
  const displayBalance = usdcBalance ?? latest?.bankroll_usdc ?? 0

  const wins = tradeHistory.filter(t => t.status === 'WIN').length
  const losses = tradeHistory.filter(t => t.status === 'LOSS').length
  const open = tradeHistory.filter(t => t.status === 'OPEN').length
  const pulled = tradeHistory.filter(t => t.status === 'PULLED').length
  const realWinRate = (wins + losses) > 0 ? (wins / (wins + losses) * 100) : null
  const totalRealPnL = tradeHistory.reduce((s, t) => s + t.pnl, 0)

  const THEORETICAL_STOP_LOSS = 0.40
  const stopLossAnalysis = {
    wouldHaveTriggered: livePositions.filter(p => {
      const drawdown = (p.currentPrice - p.initialValue / p.size) / (p.initialValue / p.size)
      return drawdown <= -THEORETICAL_STOP_LOSS
    }).map(p => ({
      title: p.title,
      entryPrice: p.initialValue / p.size,
      currentPrice: p.currentPrice,
      drawdown: (p.currentPrice - p.initialValue / p.size) / (p.initialValue / p.size),
      savedUsdc: -(p.currentValue - p.initialValue), // positive = stop loss would have saved money
    })),
    closedAnalysis: tradeHistory.filter(t => t.status !== 'OPEN' && t.status !== 'PULLED' && t.costUsdc > 0).map(t => {
      const avgEntry = t.costUsdc / (t.costUsdc / (t.costUsdc > 0 ? t.costUsdc : 1)) // simplified
      const stopLossPrice = 0.60 // would trigger at 40% loss = price * 0.60 of entry
      // If it was a loss, stop loss might have limited damage
      // If it was a win, stop loss would have been irrelevant (price recovered)
      return {
        title: t.title,
        status: t.status,
        pnl: t.pnl,
        stopLossImpact: t.status === 'WIN' ? 'no_trigger' as const :
                        t.status === 'LOSS' ? 'would_have_triggered' as const : 'unknown' as const,
        // For losses: stop loss at 40% would cap loss at 40% of cost
        cappedLoss: t.status === 'LOSS' ? -(t.costUsdc * THEORETICAL_STOP_LOSS) : 0,
        actualLoss: t.pnl,
        saved: t.status === 'LOSS' ? t.pnl - (-(t.costUsdc * THEORETICAL_STOP_LOSS)) : 0, // negative = stop loss would have saved money
      }
    }),
  }
  const stopLossWouldHaveHelped = stopLossAnalysis.closedAnalysis.filter(t => t.saved < -0.01).length
  const stopLossWouldHaveHurt = stopLossAnalysis.closedAnalysis.filter(t => t.stopLossImpact === 'no_trigger').length
  const stopLossTotalSaved = stopLossAnalysis.closedAnalysis.reduce((s, t) => s + t.saved, 0)
  const openPositionsAtRisk = stopLossAnalysis.wouldHaveTriggered.length

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.25em', color: 'var(--muted)', marginBottom: 4 }}>
            AGENDS CAPITAL
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
            <span style={{ fontSize: 13 }}>{refreshing ? '⟳' : '↺'}</span>
            {refreshing ? 'REFRESHING...' : 'REFRESH'}
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

      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 12 }}>

        <div className="card animate-slide-in">
          <div className="card-header">USDC Balance</div>
          <div className={`big-number ${(latest?.pnl_usdc ?? 0) >= 0 ? 'positive' : 'negative'}`}>
            ${fmt(displayBalance)}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ color: (latest?.pnl_usdc ?? 0) >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
              {fmtPct(latest?.roi_pct ?? 0)}
            </span>
            {' '}· {(latest?.pnl_usdc ?? 0) >= 0 ? '+' : ''}${fmt(latest?.pnl_usdc ?? 0)} P&L
          </div>
        </div>

        <div className="card animate-slide-in" style={{ animationDelay: '0.05s' }}>
          <div className="card-header">Implied P&L</div>
          <div className={`big-number ${totalImpliedPnL >= 0 ? 'positive' : 'negative'}`}>
            {totalImpliedPnL >= 0 ? '+' : ''}${fmt(totalImpliedPnL)}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            ${fmt(totalPositionValue)} value · ${fmt(totalInvested)} cost
          </div>
        </div>

        <div className="card animate-slide-in" style={{ animationDelay: '0.10s' }}>
          <div className="card-header">Win Rate</div>
          <div className={`big-number ${realWinRate !== null && realWinRate >= 50 ? 'positive' : realWinRate !== null ? 'negative' : 'neutral'}`}>
            {realWinRate !== null ? `${fmt(realWinRate, 0)}%` : '—'}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            {wins}W · {losses}L · {open} open · {pulled} pulled
          </div>
        </div>

        <div className="card animate-slide-in" style={{ animationDelay: '0.13s' }}>
          <div className="card-header">Stop Loss Tracker <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 400 }}>THEORETICAL · 40%</span></div>
          <div className={`big-number ${stopLossTotalSaved < -0.01 ? 'positive' : stopLossTotalSaved > 0.01 ? 'negative' : 'neutral'}`}>
            {stopLossTotalSaved < -0.01 ? `+$${fmt(-stopLossTotalSaved)}` : stopLossTotalSaved > 0.01 ? `-$${fmt(stopLossTotalSaved)}` : '—'}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            {stopLossWouldHaveHelped > 0 && <span style={{ color: 'var(--accent)' }}>{stopLossWouldHaveHelped} helped</span>}
            {stopLossWouldHaveHelped > 0 && stopLossWouldHaveHurt > 0 && ' · '}
            {stopLossWouldHaveHurt > 0 && <span style={{ color: 'var(--accent3)' }}>{stopLossWouldHaveHurt} would miss</span>}
            {openPositionsAtRisk > 0 && <span style={{ color: 'var(--accent2)' }}> · {openPositionsAtRisk} open at risk</span>}
            {stopLossWouldHaveHelped === 0 && stopLossWouldHaveHurt === 0 && openPositionsAtRisk === 0 && 'Insufficient data'}
          </div>
        </div>

        <div className="card animate-slide-in" style={{ animationDelay: '0.15s' }}>
          <div className="card-header">Positions / Orders</div>
          <div className="big-number neutral">
            {livePositions.length} <span style={{ fontSize: 16, color: 'var(--muted)' }}>/ {openOrders.length}</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            {totalBets} total bets placed
          </div>
        </div>

        <div className="card animate-slide-in" style={{ animationDelay: '0.20s' }}>
          <div className="card-header">Total Cost</div>
          <div className="big-number" style={{ color: 'var(--accent3)' }}>${fmt(totalCost)}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            ~${fmt((latest?.cost_per_cycle_usd ?? 0.13) * 3 * 30)} /mo projected
          </div>
        </div>

      </div>

      {/* Last Cycle + Latest Opportunities */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

        <div className="card animate-slide-in" style={{ animationDelay: '0.25s' }}>
          <div className="card-header">Last Cycle</div>
          {latest ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="mono" style={{ fontSize: 13 }}>{timeAgo(latest.created_at)}</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  next ~{nextCycleIn(latest.created_at)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {([
                  ['Scanned', latest.markets_scanned],
                  ['Evaluated', latest.markets_evaluated],
                  ['Opportunities', latest.opportunities_found],
                  ['Bets Placed', latest.bets_placed],
                  ['Cycle Cost', `$${fmt(latest.cost_per_cycle_usd, 3)}`],
                  ['Mode', latest.dry_run ? 'Dry' : 'Live'],
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

        <div className="card animate-slide-in" style={{ animationDelay: '0.30s' }}>
          <div className="card-header">Latest Opportunities</div>
          {(latest?.top_opportunities?.length ?? 0) > 0 ? (
            <div className="scroll-area" style={{ maxHeight: 220 }}>
              {latest.top_opportunities.map((opp, i) => (
                <div key={i} style={{
                  padding: '10px 0',
                  borderBottom: i < latest.top_opportunities.length - 1 ? '1px solid var(--border)' : 'none'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                    <span className={`tag ${opp.direction.toLowerCase()}`}>{opp.direction}</span>
                    <a href={opp.url} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text)', textDecoration: 'none' }}>
                      {opp.question}
                    </a>
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 12 }}>
                    <span>@ {fmt(opp.market_price * 100, 1)}¢</span>
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
      <div className="card animate-slide-in" style={{ animationDelay: '0.35s', marginBottom: 12 }}>
        <div className="card-header">
          Live Positions ({livePositions.length})
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>· live from Polymarket API</span>
        </div>
        {livePositions.length > 0 ? (
          <div className="scroll-area">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Market', 'Outcome', 'Shares', 'Price', 'Value', 'Cost', 'P&L', 'P&L %', 'End Date'].map(h => (
                    <th key={h} style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                      color: 'var(--muted)', textAlign: 'left',
                      padding: '0 12px 10px 0', textTransform: 'uppercase'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {livePositions.map((pos, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 12px 12px 0', maxWidth: 260 }}>
                      <a href={pos.url} target="_blank" rel="noopener noreferrer"
                         style={{ fontSize: 12, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4 }}>
                        {pos.title || pos.conditionId.slice(0, 24) + '...'}
                      </a>
                    </td>
                    <td style={{ padding: '12px 12px 12px 0' }}>
                      <span className={`tag ${pos.outcome.toLowerCase() === 'yes' ? 'yes' : 'no'}`}>
                        {pos.outcome}
                      </span>
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      {fmt(pos.size, 1)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      {fmt(pos.currentPrice * 100, 1)}¢
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      ${fmt(pos.currentValue)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      ${fmt(pos.initialValue)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace', color: pos.pnl >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                      {pos.pnl >= 0 ? '+' : ''}${fmt(pos.pnl)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace', color: pos.pnlPct >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                      {fmtPct(pos.pnlPct)}
                    </td>
                    <td style={{ padding: '12px 0 12px 0', fontSize: 11, color: 'var(--muted)' }}>
                      {pos.endDate ? new Date(pos.endDate).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No live positions found</div>
        )}
      </div>

      {/* Unfilled Orders */}
      <div className="card animate-slide-in" style={{ animationDelay: '0.40s', marginBottom: 12 }}>
        <div className="card-header">
          Unfilled Orders ({openOrders.length})
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>· from Supabase · updated each cycle</span>
        </div>
        {openOrders.length > 0 ? (
          <div className="scroll-area">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Market', 'Dir', 'Price', 'Size', 'Filled', 'Remaining', 'Type', 'Expires'].map(h => (
                    <th key={h} style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                      color: 'var(--muted)', textAlign: 'left',
                      padding: '0 12px 10px 0', textTransform: 'uppercase'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openOrders.map((order) => (
                  <tr key={order.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, color: 'var(--text)', maxWidth: 280 }}>
                      {order.question || order.id.slice(0, 18) + '...'}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0' }}>
                      <span className={`tag ${order.direction.toLowerCase() === 'yes' ? 'yes' : 'no'}`}>
                        {order.direction}
                      </span>
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      {fmt(order.price * 100, 1)}¢
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      ${fmt(order.original_size)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace', color: 'var(--accent)' }}>
                      ${fmt(order.size_matched)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      ${fmt(order.size_remaining)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 11, color: 'var(--muted)' }}>
                      {order.order_type}
                    </td>
                    <td style={{ padding: '12px 0 12px 0', fontSize: 11, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
                      {order.expiration ? expiresIn(order.expiration) : 'GTC'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No unfilled orders</div>
        )}
      </div>

      {/* Trade History */}
      <div className="card animate-slide-in" style={{ animationDelay: '0.48s', marginBottom: 12 }}>
        <div className="card-header">
          Trade History ({tradeHistory.length})
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>· live from Polymarket API · total P&L: <span style={{ color: totalRealPnL >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>{totalRealPnL >= 0 ? '+' : ''}${fmt(totalRealPnL)}</span></span>
        </div>
        {tradeHistory.length > 0 ? (
          <div className="scroll-area">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Market', 'Outcome', 'Cost', 'Proceeds', 'P&L', 'Status'].map(h => (
                    <th key={h} style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                      color: 'var(--muted)', textAlign: 'left',
                      padding: '0 12px 10px 0', textTransform: 'uppercase'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeHistory.map((t) => (
                  <tr key={t.conditionId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 12px 12px 0', maxWidth: 280 }}>
                      <a href={t.url} target="_blank" rel="noopener noreferrer"
                         style={{ fontSize: 12, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4 }}>
                        {t.title}
                      </a>
                    </td>
                    <td style={{ padding: '12px 12px 12px 0' }}>
                      <span className={`tag ${t.outcome.toLowerCase() === 'yes' ? 'yes' : 'no'}`}>
                        {t.outcome}
                      </span>
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      ${fmt(t.costUsdc)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
                      ${fmt(t.proceedsUsdc)}
                    </td>
                    <td style={{ padding: '12px 12px 12px 0', fontSize: 12, fontFamily: 'Space Mono, monospace', color: t.pnl >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                      {t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}
                    </td>
                    <td style={{ padding: '12px 0 12px 0' }}>
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
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No trade history found</div>
        )}
      </div>

      {/* Cycle History */}
      <div className="card animate-slide-in" style={{ animationDelay: '0.45s' }}>
        <div className="card-header">Cycle History ({cycles.length})</div>
        <div className="scroll-area">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Scanned', 'Opps', 'Bets', 'USDC', 'P&L', 'ROI', 'Cost', 'Mode'].map(h => (
                  <th key={h} style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                    color: 'var(--muted)', textAlign: 'left',
                    padding: '0 12px 10px 0', textTransform: 'uppercase'
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 11, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {timeAgo(c.created_at)}
                  </td>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>{c.markets_scanned}</td>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>{c.opportunities_found}</td>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>{c.bets_placed}</td>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>${fmt(c.bankroll_usdc)}</td>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 12, fontFamily: 'Space Mono, monospace', color: (c.pnl_usdc ?? 0) >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                    {(c.pnl_usdc ?? 0) >= 0 ? '+' : ''}${fmt(c.pnl_usdc ?? 0)}
                  </td>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 12, fontFamily: 'Space Mono, monospace', color: (c.roi_pct ?? 0) >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
                    {fmtPct(c.roi_pct ?? 0)}
                  </td>
                  <td style={{ padding: '10px 12px 10px 0', fontSize: 12, fontFamily: 'Space Mono, monospace', color: 'var(--accent3)' }}>
                    ${fmt(c.cost_per_cycle_usd ?? 0, 3)}
                  </td>
                  <td style={{ padding: '10px 0 10px 0' }}>
                    <span className={`tag ${c.dry_run ? 'dry' : 'live'}`}>{c.dry_run ? 'DRY' : 'LIVE'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
        AGENDS CAPITAL · POSITIONS LIVE FROM POLYMARKET · ORDERS & CYCLES FROM SUPABASE · AUTO-REFRESHES EVERY 60s
      </div>

    </div>
  )
}
