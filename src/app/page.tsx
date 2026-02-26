'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

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

interface Position {
  id: number
  created_at: string
  market_id: string
  question: string
  category: string
  url: string
  direction: string
  entry_price: number
  current_price: number
  our_probability: number
  bet_size_usdc: number
  unrealised_pnl: number
  status: string
  score: number
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

function fmt(n: number, dec = 2) {
  return n?.toFixed(dec) ?? '—'
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

export default function Dashboard() {
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchData = useCallback(async () => {
    const [{ data: cyclesData }, { data: positionsData }] = await Promise.all([
      supabase.from('cycles').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('positions').select('*').order('created_at', { ascending: false }),
    ])
    if (cyclesData) setCycles(cyclesData)
    if (positionsData) setPositions(positionsData)
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [fetchData])

  const latest = cycles[0]
  const isLive = latest && !latest.dry_run
  const totalCost = cycles.reduce((s, c) => s + (c.cost_per_cycle_usd || 0), 0)
  const totalBets = cycles.reduce((s, c) => s + (c.bets_placed || 0), 0)
  const winRate = latest && (latest.wins + latest.losses) > 0
    ? (latest.wins / (latest.wins + latest.losses) * 100)
    : null

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="live-dot" style={{ margin: '0 auto 12px' }} />
          <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>LOADING</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--muted)', marginBottom: 4 }}>
            AGENDS CAPITAL
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            Polymarket Bot
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="live-dot" />
            <span className={`tag ${isLive ? 'live' : 'dry'}`}>{isLive ? 'LIVE' : 'DRY RUN'}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
            {timeAgo(lastRefresh.toISOString())}
          </div>
        </div>
      </div>

      {/* Top stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>

        {/* Bankroll */}
        <div className="card animate-slide-in">
          <div className="card-header">USDC Balance</div>
          <div className={`big-number ${latest?.pnl_usdc >= 0 ? 'positive' : 'negative'}`}>
            ${fmt(latest?.bankroll_usdc ?? 500)}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            <span className={latest?.pnl_usdc >= 0 ? 'positive' : 'negative'}>
              {fmtPct(latest?.roi_pct ?? 0)}
            </span>
            {' '}· {latest?.pnl_usdc >= 0 ? '+' : ''}${fmt(latest?.pnl_usdc ?? 0)} P&L
          </div>
        </div>

        {/* Win rate */}
        <div className="card animate-slide-in" style={{ animationDelay: '0.05s' }}>
          <div className="card-header">Win Rate</div>
          <div className={`big-number ${winRate !== null && winRate >= 50 ? 'positive' : winRate !== null ? 'negative' : 'neutral'}`}>
            {winRate !== null ? `${fmt(winRate, 0)}%` : '—'}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            {latest?.wins ?? 0}W · {latest?.losses ?? 0}L · {latest?.pending ?? 0}P
          </div>
        </div>

        {/* Open positions */}
        <div className="card animate-slide-in" style={{ animationDelay: '0.10s' }}>
          <div className="card-header">Open Positions</div>
          <div className="big-number neutral">{positions.length}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            {totalBets} total bets placed
          </div>
        </div>

        {/* Cost */}
        <div className="card animate-slide-in" style={{ animationDelay: '0.15s' }}>
          <div className="card-header">Total Cost</div>
          <div className="big-number" style={{ color: 'var(--accent3)' }}>
            ${fmt(totalCost)}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            ~${fmt((latest?.cost_per_cycle_usd ?? 0.13) * 3 * 30)} /mo projected
          </div>
        </div>
      </div>

      {/* Second row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

        {/* Last cycle */}
        <div className="card animate-slide-in" style={{ animationDelay: '0.20s' }}>
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
                {[
                  ['Scanned', latest.markets_scanned],
                  ['Evaluated', latest.markets_evaluated],
                  ['Opportunities', latest.opportunities_found],
                  ['Bets placed', latest.bets_placed],
                  ['Cycle cost', `$${fmt(latest.cost_per_cycle_usd, 3)}`],
                  ['Mode', latest.dry_run ? 'Dry' : 'Live'],
                ].map(([label, value]) => (
                  <div key={label as string} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 4 }}>
                      {label}
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

        {/* Latest opportunities */}
        <div className="card animate-slide-in" style={{ animationDelay: '0.25s' }}>
          <div className="card-header">Latest Opportunities</div>
          {latest?.top_opportunities?.length > 0 ? (
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
                    <span className="positive">edge {fmt(opp.edge * 100, 1)}%</span>
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

      {/* Open positions */}
      <div className="card animate-slide-in" style={{ animationDelay: '0.30s', marginBottom: 12 }}>
        <div className="card-header">Open Positions ({positions.length})</div>
        {positions.length > 0 ? (
          <div className="scroll-area">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Market', 'Dir', 'Entry', 'Current', 'Prob', 'Size', 'P&L', 'Status'].map(h => (
                    <th key={h} style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                      color: 'var(--muted)', textAlign: 'left',
                      padding: '0 12px 10px 0', textTransform: 'uppercase'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 12px 12px 0', maxWidth: 280 }}>
                      <a href={pos.url} target="_blank" rel="noopener noreferrer"
                         style={{ fontSize: 12, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4 }}>
                        {pos.question}
                      </a>
                      <div style={{ marginTop: 2 }}>
                        <span className="tag">{pos.category}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 12px 12px 0' }}>
                      <span className={`tag ${pos.direction.toLowerCase()}`}>{pos.direction}</span>
                    </td>
                    <td className="mono" style={{ padding: '12px 12px 12px 0', fontSize: 12 }}>
                      {fmt(pos.entry_price * 100, 1)}¢
                    </td>
                    <td className="mono" style={{ padding: '12px 12px 12px 0', fontSize: 12 }}>
                      {fmt(pos.current_price * 100, 1)}¢
                    </td>
                    <td className="mono" style={{ padding: '12px 12px 12px 0', fontSize: 12, color: 'var(--accent2)' }}>
                      {fmt(pos.our_probability * 100, 1)}%
                    </td>
                    <td className="mono" style={{ padding: '12px 12px 12px 0', fontSize: 12 }}>
                      ${fmt(pos.bet_size_usdc)}
                    </td>
                    <td className={pos.unrealised_pnl >= 0 ? 'positive mono' : 'negative mono'} style={{ padding: '12px 12px 12px 0', fontSize: 12 }}>
                      {pos.unrealised_pnl >= 0 ? '+' : ''}${fmt(pos.unrealised_pnl)}
                    </td>
                    <td style={{ padding: '12px 0 12px 0', fontSize: 11, color: 'var(--muted)' }}>
                      {pos.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No open positions</div>
        )}
      </div>

      {/* Cycle history */}
      <div className="card animate-slide-in" style={{ animationDelay: '0.35s' }}>
        <div className="card-header">Cycle History ({cycles.length})</div>
        <div className="scroll-area">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Scanned', 'Opps', 'Bets', 'Bankroll', 'P&L', 'ROI', 'Cost', 'Mode'].map(h => (
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
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {timeAgo(c.created_at)}
                  </td>
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 12 }}>{c.markets_scanned}</td>
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 12 }}>{c.opportunities_found}</td>
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 12 }}>{c.bets_placed}</td>
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 12 }}>${fmt(c.bankroll_usdc)}</td>
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 12 }}
                      className={c.pnl_usdc >= 0 ? 'positive mono' : 'negative mono'}>
                    {c.pnl_usdc >= 0 ? '+' : ''}${fmt(c.pnl_usdc)}
                  </td>
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 12 }}
                      className={c.roi_pct >= 0 ? 'positive mono' : 'negative mono'}>
                    {fmtPct(c.roi_pct ?? 0)}
                  </td>
                  <td className="mono" style={{ padding: '10px 12px 10px 0', fontSize: 12, color: 'var(--accent3)' }}>
                    ${fmt(c.cost_per_cycle_usd, 3)}
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

      {/* Footer */}
      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
        AGENDS CAPITAL · AUTO-REFRESHES EVERY 60s · MAX LOSS $500
      </div>

    </div>
  )
}
