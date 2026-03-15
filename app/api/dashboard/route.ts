import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function serverClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET() {
  const sb = serverClient()
  const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  const [
    kalshiChartRes,
    kpChartRes,
    signalHealthRes,
    nextEventRes,
    discrepancyRes,
    allEventsRes,
    latestKalshiRes,
  ] = await Promise.all([
    // Kalshi probability chart — 72h
    sb.from('sibyl_signals')
      .select('value, timestamp')
      .eq('signal_type', 'prediction_probability')
      .gte('timestamp', cutoff72h)
      .order('timestamp', { ascending: true }),

    // NOAA Kp index chart — 72h (Kp scale is 0–9, filter sentinel values)
    sb.from('sibyl_signals')
      .select('value, timestamp')
      .eq('signal_type', 'geomagnetic_kp')
      .gte('timestamp', cutoff72h)
      .lte('value', 9)
      .order('timestamp', { ascending: true }),

    // Signal health — latest timestamp per family
    sb.from('sibyl_signals')
      .select('signal_family, timestamp')
      .order('timestamp', { ascending: false })
      .limit(5000),

    // Next upcoming event
    sb.from('sibyl_events')
      .select('*')
      .gte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(1),

    // Recent discrepancy/correlation findings
    sb.from('sibyl_correlation_findings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10),

    // All 2026 FOMC events
    sb.from('sibyl_events')
      .select('*')
      .gte('scheduled_at', '2026-01-01T00:00:00Z')
      .lte('scheduled_at', '2026-12-31T23:59:59Z')
      .order('scheduled_at', { ascending: true }),

    // All signals at the latest Kalshi timestamp (to find hold prob)
    sb.from('sibyl_signals')
      .select('value, timestamp')
      .eq('signal_type', 'prediction_probability')
      .order('timestamp', { ascending: false })
      .limit(50),
  ])

  // Collapse signal health to latest timestamp per family
  const familyLatest: Record<string, string> = {}
  for (const row of signalHealthRes.data ?? []) {
    if (!familyLatest[row.signal_family]) {
      familyLatest[row.signal_family] = row.timestamp
    }
  }

  // Extract hold probability: group kalshi signals by timestamp, take max value < 0.95
  // The hold contract is consistently the dominant contract (0.6–0.8 range)
  // Values near 1.0 are broader "no-change" composites, not the hold contract
  function holdProbFromBatch(rows: { value: number; timestamp: string }[]) {
    const tsMap = new Map<string, number>()
    for (const row of rows) {
      const v = Number(row.value)
      if (v >= 0.95) continue // skip composite/no-change contracts
      const prev = tsMap.get(row.timestamp) ?? 0
      if (v > prev) tsMap.set(row.timestamp, v)
    }
    return tsMap
  }

  const kalshiByTs = holdProbFromBatch(kalshiChartRes.data ?? [])
  const kalshiChart = Array.from(kalshiByTs.entries())
    .map(([timestamp, value]) => ({ value, timestamp }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  // Latest: find hold prob from most recent batch
  const latestBatch = latestKalshiRes.data ?? []
  const latestTs = latestBatch[0]?.timestamp
  const latestHold = latestTs
    ? Math.max(0, ...latestBatch
        .filter(r => r.timestamp === latestTs && Number(r.value) < 0.95)
        .map(r => Number(r.value)))
    : null
  const latestKalshi = latestHold && latestTs
    ? { value: latestHold, timestamp: latestTs }
    : null

  return NextResponse.json({
    kalshiChart,
    kpChart: kpChartRes.data ?? [],
    signalHealth: familyLatest,
    nextEvent: nextEventRes.data?.[0] ?? null,
    discrepancyFindings: discrepancyRes.data ?? [],
    allEvents: allEventsRes.data ?? [],
    latestKalshi,
    fetchedAt: new Date().toISOString(),
    _errors: {
      kalshiChart: kalshiChartRes.error?.message,
      kpChart: kpChartRes.error?.message,
      signalHealth: signalHealthRes.error?.message,
      nextEvent: nextEventRes.error?.message,
      discrepancy: discrepancyRes.error?.message,
      allEvents: allEventsRes.error?.message,
    },
  })
}
