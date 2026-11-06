// Refi Watch, step 1: the benchmark scenarios an admin prices Mon/Wed/Fri.
// Labels, "last priced", stale pricing and the save rows. Pure functions, no
// data access.

export type RefiProgram = 'conventional' | 'fha'
export type RefiPurpose = 'rate_term' | 'streamline'
export type RefiRunStatus = 'open' | 'saved' | 'skipped' | 'missed'

export interface RefiScenario {
  id: string
  name: string
  program: RefiProgram
  purpose: RefiPurpose
  fico: number
  /** Null for an FHA Streamline (no appraisal). */
  ltv: number | null
  /** The scenario FHA loans are compared against for MIP removal. */
  mipRemoval: boolean
  active: boolean
  sortOrder: number
}

export interface RefiBenchmark {
  id: string
  scenarioId: string
  benchmarkDate: string
  rate: number
  /** Points the borrower pays; negative = a lender credit. */
  pointsOrCredit: number
  lender: string | null
  createdAt: string
}

export interface RefiRun {
  id: string
  runDate: string
  kind: 'scheduled' | 'manual'
  status: RefiRunStatus
  actedAt: string | null
  createdAt: string
}

/** One row of the pricing screen as typed. */
export interface BenchmarkDraft {
  scenarioId: string
  rate: number | null
  pointsOrCredit: number | null
  lender: string
}

export const PROGRAM_OPTIONS = [
  { value: 'conventional', label: 'Conventional' },
  { value: 'fha', label: 'FHA' },
] as const

export const PURPOSE_OPTIONS = [
  { value: 'rate_term', label: 'Rate/term' },
  { value: 'streamline', label: 'Streamline' },
] as const

/** "Conv R/T 720 · 90%", "FHA Streamline 640". */
export function scenarioLabel(s: Pick<RefiScenario, 'program' | 'purpose' | 'fico' | 'ltv'>): string {
  const program = s.program === 'fha' ? 'FHA' : 'Conv'
  const kind = s.purpose === 'streamline' ? 'Streamline' : 'R/T'
  return `${program} ${kind} ${s.fico}${s.ltv != null ? ` · ${formatLtv(s.ltv)}` : ''}`
}

/** 90 → "90%", 97.5 → "97.5%". */
export function formatLtv(ltv: number): string {
  return `${Number(ltv.toFixed(2))}%`
}

/** 0.25 → "0.250 pts", -0.25 → "0.250 credit", 0 → "0.000". */
export function formatPoints(points: number): string {
  const n = Math.abs(points).toFixed(3)
  return points > 0 ? `${n} pts` : points < 0 ? `${n} credit` : n
}

/** Active scenarios in their set order (then by name), the way the pricing screen lists them. */
export function orderScenarios<T extends Pick<RefiScenario, 'active' | 'sortOrder' | 'name' | 'fico'>>(scenarios: T[], activeOnly = true): T[] {
  return scenarios
    .filter((s) => !activeOnly || s.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || b.fico - a.fico)
}

/** The most recent price for each scenario. */
export function latestByScenario(benchmarks: RefiBenchmark[]): Map<string, RefiBenchmark> {
  const latest = new Map<string, RefiBenchmark>()
  for (const b of benchmarks) {
    const seen = latest.get(b.scenarioId)
    if (!seen || b.createdAt > seen.createdAt) latest.set(b.scenarioId, b)
  }
  return latest
}

/** The run waiting for the admin, if any (the newest open one). */
export function openRun(runs: RefiRun[]): RefiRun | null {
  return [...runs].filter((r) => r.status === 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

/**
 * Pricing is stale when the last run anyone answered (or that went by) was
 * skipped or missed: screening keeps the last saved set and alerts show
 * "Stale pricing" until the next save. A run still open doesn't decide it.
 */
export function pricingIsStale(runs: RefiRun[]): boolean {
  const last = [...runs].filter((r) => r.status !== 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return !!last && (last.status === 'skipped' || last.status === 'missed')
}

/** A row's problem, or null when it's fine (a row with no rate is left out, not a problem). */
export function draftError(d: BenchmarkDraft): string | null {
  if (d.rate == null) return d.pointsOrCredit != null && d.pointsOrCredit !== 0 ? 'Enter a rate, or clear the points.' : null
  if (d.rate <= 0 || d.rate >= 20) return 'Rate must be between 0% and 20%.'
  if (d.pointsOrCredit != null && (d.pointsOrCredit < -10 || d.pointsOrCredit > 10)) return 'Points must be between -10 and 10.'
  return null
}

/** How many rows have a rate. */
export const pricedCount = (drafts: BenchmarkDraft[]) => drafts.filter((d) => d.rate != null).length

/** The rows the save sends: only priced ones; blank points = 0, blank lender = none. */
export function saveRows(drafts: BenchmarkDraft[]): { scenario_id: string; rate: number; points_or_credit: number; lender: string | null }[] {
  return drafts.flatMap((d) =>
    d.rate == null ? [] : [{ scenario_id: d.scenarioId, rate: d.rate, points_or_credit: d.pointsOrCredit ?? 0, lender: d.lender.trim() || null }],
  )
}

/** A blank row per scenario, with the lender carried over from its last price. */
export function blankDrafts(scenarios: Pick<RefiScenario, 'id'>[], latest: Map<string, RefiBenchmark>): BenchmarkDraft[] {
  return scenarios.map((s) => ({ scenarioId: s.id, rate: null, pointsOrCredit: null, lender: latest.get(s.id)?.lender ?? '' }))
}

/** A scenario's problem in Settings, or null. */
export function scenarioError(s: Pick<RefiScenario, 'name' | 'program' | 'purpose' | 'fico' | 'ltv'>): string | null {
  if (!s.name.trim()) return 'Give it a name.'
  if (!Number.isInteger(s.fico) || s.fico < 300 || s.fico > 850) return 'FICO must be a whole number from 300 to 850.'
  if (s.purpose === 'streamline' && s.program !== 'fha') return 'Only FHA has a streamline here.'
  if (s.purpose === 'rate_term' && (s.ltv == null || s.ltv <= 0 || s.ltv > 125)) return 'Enter an LTV up to 125%.'
  return null
}
