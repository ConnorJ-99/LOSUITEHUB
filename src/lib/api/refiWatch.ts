// Refi Watch data: benchmark scenarios (Settings › Refi Watch), the prices
// saved Mon/Wed/Fri, and the pricing runs. Saving and skipping go through
// database functions that also close the admin's "Price refi benchmarks" task.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { saveRows, type BenchmarkDraft, type RefiBenchmark, type RefiProgram, type RefiPurpose, type RefiRun, type RefiScenario } from '@/lib/refi/benchmarks'
import { db, keys, num, unwrap } from './client'

export const refiKeys = {
  scenarios: ['refi', 'scenarios'] as const,
  benchmarks: ['refi', 'benchmarks'] as const,
  runs: ['refi', 'runs'] as const,
}

interface ScenarioRow {
  id: string
  name: string
  program: RefiProgram
  purpose: RefiPurpose
  fico: number
  ltv: number | string | null
  mip_removal: boolean
  active: boolean
  sort_order: number
}

const toScenario = (r: ScenarioRow): RefiScenario => ({
  id: r.id,
  name: r.name,
  program: r.program,
  purpose: r.purpose,
  fico: r.fico,
  ltv: num(r.ltv),
  mipRemoval: r.mip_removal,
  active: r.active,
  sortOrder: r.sort_order,
})

function useOrgId() {
  const { state } = useAuth()
  return state.status === 'signedIn' ? state.user.organizationId : null
}

export function useRefiScenarios() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: refiKeys.scenarios,
    enabled: !!orgId,
    queryFn: async () =>
      unwrap<ScenarioRow[]>(await db().from('refi_benchmark_scenarios').select('id, name, program, purpose, fico, ltv, mip_removal, active, sort_order').eq('organization_id', orgId!).order('sort_order')).map(toScenario),
  })
}

/** Recent prices (enough to show each scenario's last one). */
export function useRefiBenchmarks() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: refiKeys.benchmarks,
    enabled: !!orgId,
    queryFn: async () =>
      unwrap<{ id: string; scenario_id: string; benchmark_date: string; rate: number | string; points_or_credit: number | string; lender: string | null; created_at: string }[]>(
        await db().from('refi_benchmarks').select('id, scenario_id, benchmark_date, rate, points_or_credit, lender, created_at').eq('organization_id', orgId!).order('created_at', { ascending: false }).limit(200),
      ).map(
        (r): RefiBenchmark => ({ id: r.id, scenarioId: r.scenario_id, benchmarkDate: r.benchmark_date, rate: num(r.rate) ?? 0, pointsOrCredit: num(r.points_or_credit) ?? 0, lender: r.lender, createdAt: r.created_at }),
      ),
  })
}

export function useRefiRuns() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: refiKeys.runs,
    enabled: !!orgId,
    queryFn: async () =>
      unwrap<{ id: string; run_date: string; kind: RefiRun['kind']; status: RefiRun['status']; acted_at: string | null; created_at: string }[]>(
        await db().from('refi_benchmark_runs').select('id, run_date, kind, status, acted_at, created_at').eq('organization_id', orgId!).order('created_at', { ascending: false }).limit(20),
      ).map((r): RefiRun => ({ id: r.id, runDate: r.run_date, kind: r.kind, status: r.status, actedAt: r.acted_at, createdAt: r.created_at })),
  })
}

function useRefreshRefi() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['refi'] })
    // The admin's task closes too.
    queryClient.invalidateQueries({ queryKey: keys.myTasks })
  }
}

export function useSaveBenchmarks() {
  const orgId = useOrgId()
  const refresh = useRefreshRefi()
  return useMutation({
    mutationFn: async (drafts: BenchmarkDraft[]) => unwrap<string>(await db().rpc('save_refi_benchmarks', { p_org: orgId, p_rows: saveRows(drafts) })),
    onSuccess: refresh,
  })
}

export function useSkipBenchmarkRun() {
  const orgId = useOrgId()
  const refresh = useRefreshRefi()
  return useMutation({
    mutationFn: async () => {
      unwrap(await db().rpc('skip_refi_benchmark_run', { p_org: orgId }))
    },
    onSuccess: refresh,
  })
}

export type ScenarioDraft = Omit<RefiScenario, 'id' | 'mipRemoval'> & { id: string | null }

export function useSaveScenario() {
  const orgId = useOrgId()
  const refresh = useRefreshRefi()
  return useMutation({
    mutationFn: async (s: ScenarioDraft) => {
      const row = { name: s.name.trim(), program: s.program, purpose: s.purpose, fico: s.fico, ltv: s.purpose === 'streamline' ? null : s.ltv, active: s.active, sort_order: s.sortOrder }
      if (s.id) unwrap(await db().from('refi_benchmark_scenarios').update(row).eq('id', s.id).select('id'))
      else unwrap(await db().from('refi_benchmark_scenarios').insert({ ...row, organization_id: orgId }).select('id'))
    },
    onSuccess: refresh,
  })
}

/** Deletes a scenario that was never priced (a priced one can only be turned off). */
export function useDeleteScenario() {
  const refresh = useRefreshRefi()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from('refi_benchmark_scenarios').delete().eq('id', id)
      if (error) throw new Error(/foreign key|violates/i.test(error.message) ? 'This scenario has been priced, so it can only be turned off.' : error.message)
    },
    onSuccess: refresh,
  })
}
