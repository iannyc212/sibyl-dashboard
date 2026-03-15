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

    // NOAA Kp index chart — 72h
    sb.from('sibyl_signals')
      .select('value, timestamp')
      .eq('signal_type', 'geomagnetic_kp')
      .gte('timestamp', cutoff72h)
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

    // Latest Kalshi prediction probability value
    sb.from('sibyl_signals')
      .select('value, timestamp')
      .eq('signal_type', 'prediction_probability')
      .order('timestamp', { ascending: false })
      .limit(1),
  ])

  // Collapse signal health to latest timestamp per family
  const familyLatest: Record<string, string> = {}
  for (const row of signalHealthRes.data ?? []) {
    if (!familyLatest[row.signal_family]) {
      familyLatest[row.signal_family] = row.timestamp
    }
  }

  return NextResponse.json({
    kalshiChart: kalshiChartRes.data ?? [],
    kpChart: kpChartRes.data ?? [],
    signalHealth: familyLatest,
    nextEvent: nextEventRes.data?.[0] ?? null,
    discrepancyFindings: discrepancyRes.data ?? [],
    allEvents: allEventsRes.data ?? [],
    latestKalshi: latestKalshiRes.data?.[0] ?? null,
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
