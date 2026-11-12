// Match lenders (Scenarios & Estimate): the file's scenario run through the
// same rule-based Product Search engine, with a score and grade per program,
// short reason lines, and Fits / Near miss / Excluded. Pure: nothing here
// reads or changes the file.

import { formatPercent } from '@/lib/format'
import { search } from './engine'
import { LENDER_STATUSES, MATRIX_PURPOSES, PRODUCT_FAMILIES, type ProductFamily } from './taxonomy'
import type { Catalog, ProgramResult, Scenario } from './types'

export type MatchStatus = 'fits' | 'near_miss' | 'excluded'
export type Grade = 'A' | 'B' | 'C' | 'D'

export interface MatchLine {
  /** pass = meets it with room, limit = at or near the limit, verify = unknown on the file, fail = doesn't fit. */
  tone: 'pass' | 'limit' | 'verify' | 'fail'
  text: string
}

export interface MatchRow {
  result: ProgramResult
  status: MatchStatus
  /** 0–100; null for excluded programs. */
  score: number | null
  grade: Grade | null
  lines: MatchLine[]
  /** Near misses: the one thing that fails and by how much ("Max LTV 85% at 700–719; scenario is 90%"). */
  miss: string | null
}

export interface MatchResult {
  fits: MatchRow[]
  nearMisses: MatchRow[]
  excluded: MatchRow[]
  /** Programs of another kind (lien or income documentation), never evaluated. */
  notSearched: number
  ratios: { ltv: number; cltv: number }
}

/** Grade bands: A 90+, B 80–89, C 70–79, D below 70. */
export function gradeFor(score: number): Grade {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D'
}

/** Where matching starts: the file's scenario widened to every product type its lien and income documentation allow (the parameters can narrow it). */
export function matchScenario(s: Scenario): Scenario {
  return { ...s, family: 'any', features: [] }
}

/** The catalog without VA programs unless the borrower can use VA. */
export function matchCatalog(catalog: Catalog, vaEligible: boolean): Catalog {
  return vaEligible ? catalog : { ...catalog, programs: catalog.programs.filter((p) => p.family !== 'va') }
}

const LENDER_PENALTY = { approved: 0, pending: 5, not_signed_up: 10, inactive: 20 } as const

/** The tightest max DTI that applies to this program: a rule that was checked, else the matrix cell's. */
function maxDtiOf(r: ProgramResult): number | null {
  const checked = new Set(r.checklist.filter((c) => c.status !== 'na' && c.trace.ruleId).map((c) => c.trace.ruleId))
  const caps = r.program.rules.filter((x) => x.field === 'dti' && x.op === '<=' && typeof x.value === 'number' && checked.has(x.id)).map((x) => x.value as number)
  if (r.cell?.maxDti != null) caps.push(r.cell.maxDti)
  return caps.length ? Math.min(...caps) : null
}

const pct = (v: number) => formatPercent(v, 2)

/** Short plain lines: what passed, what's at the limit, what's unknown and what failed. */
export function matchLines(r: ProgramResult, s: Scenario): MatchLine[] {
  const lines: MatchLine[] = []
  if (s.fico != null && r.ficoFloor != null && s.fico >= r.ficoFloor) lines.push({ tone: s.fico - r.ficoFloor < 10 ? 'limit' : 'pass', text: `FICO ${s.fico} meets ${r.ficoFloor} min` })
  if (r.limit && r.limit.roomPts >= -1e-9) {
    const ratio = r.limit.ratio.toUpperCase()
    lines.push(r.limit.roomPts < 0.5 ? { tone: 'limit', text: `${ratio} ${pct(r.limit.actual)} at max` } : { tone: 'pass', text: `${ratio} ${pct(r.limit.actual)} · max ${formatPercent(r.limit.max, 3)}` })
  }
  const dtiMax = maxDtiOf(r)
  if (dtiMax != null && s.dti != null && s.dti <= dtiMax + 1e-9) lines.push(dtiMax - s.dti < 2 ? { tone: 'limit', text: `DTI ${pct(s.dti)} near ${pct(dtiMax)} max` } : { tone: 'pass', text: `DTI ${pct(s.dti)} · max ${pct(dtiMax)}` })
  if (r.lender.status !== 'approved') lines.push({ tone: 'limit', text: `Lender: ${LENDER_STATUSES.label[r.lender.status].toLowerCase()}` })
  for (const c of r.checklist) if (c.status === 'verify') lines.push({ tone: 'verify', text: `Verify: ${c.message}` })
  for (const x of r.reasons) lines.push({ tone: 'fail', text: x.fix ? `${x.message} (${x.fix.text})` : x.message })
  return lines
}

/** The lines as shown on a row: at most `maxVerify` Verify lines, then "+N more to verify" (the full list stays on the row's tooltip). */
export function shortLines(lines: MatchLine[], maxVerify = 2): MatchLine[] {
  const verify = lines.filter((l) => l.tone === 'verify')
  if (verify.length <= maxVerify) return lines
  const kept = new Set(verify.slice(0, maxVerify))
  const out = lines.filter((l) => l.tone !== 'verify' || kept.has(l))
  const at = out.findIndex((l) => l === verify[maxVerify - 1]) + 1
  out.splice(at, 0, { tone: 'verify', text: `+${verify.length - maxVerify} more to verify` })
  return out
}

/** Score for a program that fits: 100, less points for being at a limit, unknowns and the lender's status. */
function fitScore(r: ProgramResult, lines: MatchLine[]): number {
  let score = 100
  const room = r.limit?.roomPts ?? 0
  if (room < 1) score -= 8
  else if (room < 3) score -= 4
  const verify = lines.filter((l) => l.tone === 'verify').length
  score -= 3 * Math.min(verify, 5)
  if (lines.some((l) => l.tone === 'limit' && l.text.startsWith('DTI'))) score -= 5
  if (lines.some((l) => l.tone === 'limit' && l.text.startsWith('FICO'))) score -= 3
  score -= LENDER_PENALTY[r.lender.status]
  return Math.max(0, Math.min(100, score))
}

/** Near misses stay below 80: 79 less the size of the miss (in percent of the limit) and the lender's status. */
function nearMissScore(r: ProgramResult): number {
  const gap = r.reasons[0]?.gap ?? 1
  return Math.max(40, 79 - Math.round(Math.min(gap, 1) * 100) - LENDER_PENALTY[r.lender.status])
}

export function classify(r: ProgramResult, s: Scenario): MatchRow {
  const lines = matchLines(r, s)
  if (r.eligible) {
    const score = fitScore(r, lines)
    return { result: r, status: 'fits', score, grade: gradeFor(score), lines, miss: null }
  }
  // Fails exactly one thing, and a change in the scenario could fix it.
  if (r.reasons.length === 1 && !r.reasons[0].unfixable) {
    const score = nearMissScore(r)
    const x = r.reasons[0]
    return { result: r, status: 'near_miss', score, grade: gradeFor(score), lines, miss: x.fix ? `${x.message} (${x.fix.text})` : x.message }
  }
  return { result: r, status: 'excluded', score: null, grade: null, lines, miss: null }
}

/** Highest score first; ties keep the engine's own ranking. */
const byScore = (rows: MatchRow[]) => [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

/** Matches the parameters as given (start them from `matchScenario`). VA programs are left out unless the borrower is VA eligible or VA is the product family picked. */
export function matchLenders(scenario: Scenario, catalog: Catalog, vaEligible: boolean): MatchResult {
  const result = search(scenario, matchCatalog(catalog, vaEligible || scenario.family === 'va'))
  const rows = [...result.eligible, ...result.ineligible].map((r) => classify(r, scenario))
  return {
    fits: byScore(rows.filter((r) => r.status === 'fits')),
    nearMisses: byScore(rows.filter((r) => r.status === 'near_miss')),
    excluded: rows.filter((r) => r.status === 'excluded'),
    notSearched: result.notSearched.count,
    ratios: result.ratios,
  }
}

/** "Purchase · Conventional · 720 FICO · 90% LTV · TX · 12 programs fit · 3 near misses." */
export function matchContext(s: Scenario, m: MatchResult, loanType: string | null): string {
  const ratio = s.lien === 'first' ? `${formatPercent(m.ratios.ltv, 2)} LTV` : `${formatPercent(m.ratios.cltv, 2)} CLTV`
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  return [MATRIX_PURPOSES.label[s.purpose], loanType, s.fico != null ? `${s.fico} FICO` : null, ratio, s.state, n(m.fits.length, 'program fits', 'programs fit'), n(m.nearMisses.length, 'near miss', 'near misses')].filter(Boolean).join(' · ')
}

/** Product types that have at least one fit or near miss, for the filter chips. */
export function matchFamilies(m: MatchResult): ProductFamily[] {
  const seen = new Set([...m.fits, ...m.nearMisses].map((r) => r.result.program.family))
  return PRODUCT_FAMILIES.values.filter((f) => seen.has(f))
}
