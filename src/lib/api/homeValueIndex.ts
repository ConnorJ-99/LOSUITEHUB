// The FHFA home price index behind MyHome's home value estimate (closed view
// Step B): what's loaded, the last refresh, and "Refresh now" (owners and
// admins; the hpi-refresh Edge Function checks that itself).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client'

export interface IndexStatus {
  /** Latest quarter loaded per area, e.g. { Dallas: '2026 Q2 · 426.45' }. */
  areas: { area: string; quarter: string; index: number }[]
  lastRun: { ranAt: string; source: string | null; quarters: number; latest: string | null; problem: string | null } | null
}

const AREA: Record<string, string> = { '19124': 'Dallas', '23104': 'Fort Worth' }
const key = ['homeValueIndex'] as const

/** Null before the home value script has run. */
export function useHomeValueIndex() {
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<IndexStatus | null> => {
      const [latest, runs] = await Promise.all([
        db().from('home_price_index').select('series, year, quarter, index').order('year', { ascending: false }).order('quarter', { ascending: false }).limit(20),
        db().from('home_price_index_runs').select('ran_at, source, quarters, latest, problem').order('ran_at', { ascending: false }).limit(1),
      ])
      if (latest.error || runs.error) return null
      const areas: IndexStatus['areas'] = []
      for (const r of (latest.data ?? []) as { series: string; year: number; quarter: number; index: number }[]) {
        if (areas.some((a) => a.area === AREA[r.series])) continue
        areas.push({ area: AREA[r.series] ?? r.series, quarter: `${r.year} Q${r.quarter}`, index: Number(r.index) })
      }
      const run = ((runs.data ?? []) as { ran_at: string; source: string | null; quarters: number; latest: string | null; problem: string | null }[])[0]
      return { areas, lastRun: run ? { ranAt: run.ran_at, source: run.source, quarters: run.quarters, latest: run.latest, problem: run.problem } : null }
    },
  })
}

export function useRefreshHomeValueIndex() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await db().functions.invoke<{ source: string; newQuarters: number; latest: string | null }>('hpi-refresh', { body: {} })
      if (error) {
        const ctx = (error as { context?: Response }).context
        const body = ctx && typeof ctx.json === 'function' ? ((await ctx.json().catch(() => null)) as { error?: string } | null) : null
        throw new Error(body?.error ?? 'The index could not be refreshed. Is the hpi-refresh function deployed?')
      }
      return data!
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
