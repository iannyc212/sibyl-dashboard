'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChartPoint { value: number; timestamp: string }

interface FomcEvent {
  event_id: string
  scheduled_at: string
  event_status: string
  event_subtype: string | null
  label: string | null
  resolution: string | null
  resolution_value: number | null
  resolution_direction: string | null
}

interface CorrelationFinding {
  finding_id: string
  family_a: string
  signal_type_a: string
  family_b: string
  signal_type_b: string
  correlation_coeff: number
  notes: string | null
  created_at: string
}

interface DashboardData {
  kalshiChart: ChartPoint[]
  kpChart: ChartPoint[]
  signalHealth: Record<string, string>
  nextEvent: FomcEvent | null
  discrepancyFindings: CorrelationFinding[]
  allEvents: FomcEvent[]
  latestKalshi: { value: number; timestamp: string } | null
  fetchedAt: string
}

// ─── Signal family thresholds (minutes) ───────────────────────────────────────
// Keys are signal_family values from the DB (uppercase)

const FAMILY_THRESHOLDS: Record<string, number> = {
  FRED:         360,
  KALSHI:       480,
  NASA:         1440,
  NOAA:         60,
  NEWS:         60,
  LINKER:       30,
  DISCREPANCY:  360,
  ALERTS:       30,
  CORRELATION:  10080,
  // Actual families observed in DB
  MARKET:       480,
  STRUCTURAL:   360,
  NARRATIVE:    60,
  COORDINATION: 10080,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function workerStatus(lastSeen: string | undefined, thresholdMin: number): 'green' | 'yellow' | 'red' {
  if (!lastSeen) return 'red'
  const ageMin = (Date.now() - new Date(lastSeen).getTime()) / 60000
  if (ageMin <= thresholdMin) return 'green'
  if (ageMin <= thresholdMin * 2) return 'yellow'
  return 'red'
}

const STATUS_COLOR = {
  green:  'bg-green-500',
  yellow: 'bg-yellow-400',
  red:    'bg-red-500',
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtRelTime(iso: string) {
  const ageMin = (Date.now() - new Date(iso).getTime()) / 60000
  if (ageMin < 1) return 'just now'
  if (ageMin < 60) return `${Math.floor(ageMin)}m ago`
  if (ageMin < 1440) return `${Math.floor(ageMin / 60)}h ago`
  return `${Math.floor(ageMin / 1440)}d ago`
}

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function kpColor(kp: number): string {
  if (kp < 4) return '#22c55e'
  if (kp < 6) return '#eab308'
  return '#ef4444'
}

function eventStatusBadge(status: string) {
  const map: Record<string, string> = {
    provisional: 'text-zinc-400 bg-zinc-800',
    confirmed:   'text-blue-300 bg-blue-950',
    resolved:    'text-green-300 bg-green-950',
  }
  return map[status?.toLowerCase()] ?? 'text-zinc-400 bg-zinc-800'
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, suffix }: {
  active?: boolean; payload?: { value: number }[]; label?: string; suffix?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs">
      <p className="text-zinc-400">{label}</p>
      <p className="text-zinc-100 font-semibold">{payload[0].value.toFixed(1)}{suffix}</p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SibylDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as DashboardData
      setData(json)
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Chart data formatting
  const kalshiChartData = (data?.kalshiChart ?? []).map(p => ({
    t: fmtTime(p.timestamp),
    v: Math.round(Number(p.value) * 100) / 100,
  }))

  const kpChartData = (data?.kpChart ?? []).map(p => ({
    t: fmtTime(p.timestamp),
    v: Number(p.value),
  }))

  const holdProb = data?.latestKalshi ? Math.round(Number(data.latestKalshi.value)) : null

  return (
    <main className="min-h-screen bg-zinc-950 p-4 md:p-6 max-w-5xl mx-auto">

      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-widest text-indigo-400 uppercase">Sibyl</span>
          <span className="text-zinc-600 text-xs">FOMC Intelligence Monitor</span>
        </div>
        <div className="text-xs text-zinc-500">
          {lastRefresh ? `Updated ${fmtRelTime(lastRefresh.toISOString())}` : 'Loading…'}
          {' · '}
          <span className="text-zinc-600">auto-refresh 5m</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm px-4 py-3">
          Failed to load data: {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
          Loading…
        </div>
      )}

      {data && (
        <div className="space-y-5">

          {/* ── FOMC Event Header ─────────────────────────────────────────── */}
          <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

              {/* Next event info */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Next FOMC Decision</p>
                {data.nextEvent ? (
                  <>
                    <p className="text-2xl font-bold text-zinc-100">
                      {fmtDate(data.nextEvent.scheduled_at)}
                    </p>
                    <p className="text-sm text-zinc-400 mt-1">
                      <span className="text-indigo-400 font-semibold">
                        {daysUntil(data.nextEvent.scheduled_at)}d
                      </span>
                      {' '}until decision
                      {data.nextEvent.event_subtype && (
                        <span className="ml-2 text-zinc-500">· {data.nextEvent.event_subtype}</span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-zinc-500 text-sm">No upcoming events</p>
                )}
              </div>

              {/* Kalshi hold probability */}
              <div className="md:text-right">
                <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Kalshi Hold Probability</p>
                {holdProb !== null ? (
                  <div className="flex items-end gap-1 md:justify-end">
                    <span className="text-5xl font-black text-indigo-400 leading-none tabular-nums">
                      {holdProb}
                    </span>
                    <span className="text-xl text-indigo-500 font-bold pb-1">%</span>
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">No data</p>
                )}
                {data.latestKalshi && (
                  <p className="text-xs text-zinc-600 mt-1">
                    as of {fmtRelTime(data.latestKalshi.timestamp)}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── Kalshi Probability Chart ──────────────────────────────────── */}
          <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-4">
              Kalshi Hold Probability — Last 72h
            </p>
            {kalshiChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={kalshiChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="t"
                    tick={{ fill: '#71717a', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#71717a', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#818cf8' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-zinc-600 text-sm">
                No data in last 72h
              </div>
            )}
          </section>

          {/* ── Signal Health + NOAA Chart ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Signal Health Panel */}
            <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-4">Signal Health</p>
              <div className="space-y-2">
                {Object.entries(data.signalHealth).length === 0 ? (
                  <p className="text-zinc-600 text-sm">No signal data</p>
                ) : (
                  Object.entries(data.signalHealth)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([family, lastSeen]) => {
                      const threshold = FAMILY_THRESHOLDS[family.toUpperCase()] ?? 360
                      const status = workerStatus(lastSeen, threshold)
                      return (
                        <div key={family} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLOR[status]} ${status === 'green' ? 'shadow-[0_0_6px_1px_rgba(34,197,94,0.5)]' : ''}`}
                            />
                            <span className="text-sm text-zinc-200">{family}</span>
                          </div>
                          <span className="text-xs text-zinc-500 tabular-nums">
                            {fmtRelTime(lastSeen)}
                          </span>
                        </div>
                      )
                    })
                )}
              </div>
            </section>

            {/* NOAA Kp Index Chart */}
            <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-4">
                NOAA Kp Index — Last 72h
              </p>
              {kpChartData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={kpChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis
                        dataKey="t"
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        domain={[0, 9]}
                        ticks={[0, 3, 5, 7, 9]}
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                        {kpChartData.map((entry, i) => (
                          <Cell key={i} fill={kpColor(entry.v)} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                    <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />Quiet (&lt;4)</span>
                    <span><span className="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-1" />Active (4–6)</span>
                    <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Storm (&gt;6)</span>
                  </div>
                </>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-zinc-600 text-sm">
                  No data in last 72h
                </div>
              )}
            </section>
          </div>

          {/* ── Recent Discrepancy Findings ───────────────────────────────── */}
          <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-4">
              Recent Correlation Findings
            </p>
            {data.discrepancyFindings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                      <th className="pb-2 pr-4 font-normal">Signal Pair</th>
                      <th className="pb-2 pr-4 font-normal text-right">Corr</th>
                      <th className="pb-2 pr-4 font-normal hidden md:table-cell">Notes</th>
                      <th className="pb-2 font-normal text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {data.discrepancyFindings.map(f => {
                      const coeff = Number(f.correlation_coeff)
                      const coeffColor = Math.abs(coeff) > 0.7
                        ? 'text-indigo-400'
                        : Math.abs(coeff) > 0.4
                          ? 'text-yellow-400'
                          : 'text-zinc-400'
                      return (
                        <tr key={f.finding_id} className="text-zinc-300">
                          <td className="py-2 pr-4">
                            <span className="text-zinc-200">{f.family_a}</span>
                            <span className="text-zinc-500 mx-1">/</span>
                            <span className="text-zinc-200">{f.family_b}</span>
                            <div className="text-xs text-zinc-600">
                              {f.signal_type_a} · {f.signal_type_b}
                            </div>
                          </td>
                          <td className={`py-2 pr-4 text-right font-mono font-semibold ${coeffColor}`}>
                            {coeff > 0 ? '+' : ''}{coeff.toFixed(3)}
                          </td>
                          <td className="py-2 pr-4 text-zinc-500 text-xs hidden md:table-cell max-w-xs truncate">
                            {f.notes ?? '—'}
                          </td>
                          <td className="py-2 text-right text-xs text-zinc-500 whitespace-nowrap">
                            {fmtDate(f.created_at)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-zinc-600 text-sm">No findings yet</p>
            )}
          </section>

          {/* ── FOMC Event Timeline ───────────────────────────────────────── */}
          <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-4">
              2026 FOMC Event Timeline
            </p>
            {data.allEvents.length > 0 ? (
              <div className="space-y-2">
                {data.allEvents.map((ev, i) => {
                  const isPast = new Date(ev.scheduled_at) < new Date()
                  const isNext = data.nextEvent?.event_id === ev.event_id
                  return (
                    <div
                      key={ev.event_id}
                      className={`flex items-start gap-3 rounded-lg px-3 py-2 ${
                        isNext
                          ? 'bg-indigo-950/60 border border-indigo-800/50'
                          : 'border border-transparent'
                      }`}
                    >
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center mt-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          ev.resolution
                            ? 'bg-green-500'
                            : isPast
                              ? 'bg-zinc-600'
                              : isNext
                                ? 'bg-indigo-400 shadow-[0_0_6px_1px_rgba(99,102,241,0.5)]'
                                : 'bg-zinc-700'
                        }`} />
                        {i < data.allEvents.length - 1 && (
                          <div className="w-px flex-1 bg-zinc-800 mt-1 min-h-[12px]" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${isPast ? 'text-zinc-500' : 'text-zinc-200'}`}>
                            {ev.label ?? fmtDate(ev.scheduled_at)}
                          </span>
                          {isNext && (
                            <span className="text-xs text-indigo-400 font-semibold">← next</span>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${eventStatusBadge(ev.event_status)}`}>
                            {ev.event_status}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-600">{fmtDate(ev.scheduled_at)}</p>
                        {ev.resolution && (
                          <p className="text-xs text-green-400 mt-0.5">
                            Outcome: <span className="font-semibold">{ev.resolution}</span>
                            {ev.resolution_direction && ` · ${ev.resolution_direction}`}
                          </p>
                        )}
                      </div>

                      {!isPast && !ev.resolution && (
                        <span className="text-xs text-zinc-600 whitespace-nowrap mt-0.5">
                          {daysUntil(ev.scheduled_at)}d
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-zinc-600 text-sm">No 2026 events found</p>
            )}
          </section>

        </div>
      )}

      <p className="mt-8 text-center text-xs text-zinc-700">
        Sibyl · Read-only monitor · Data via Supabase
      </p>
    </main>
  )
}
