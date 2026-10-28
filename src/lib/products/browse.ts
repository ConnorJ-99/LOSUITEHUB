// Browse all programs (mockup 05): every program from every lender, no
// scenario needed. Product groups, each program's headline numbers from its
// approved matrix, filters with counts, and sorting. Pure.

import { isDpaProgram, type Lien, type LenderStatus } from './taxonomy'
import type { Catalog, CatalogLender, CatalogProgram, ProgramResult } from './types'

/** The product groups in the left filter, in order. Non-QM is split by doc type; DPA is its own group. */
export const BROWSE_GROUPS = [
  ['conventional', 'Conventional'],
  ['fha', 'FHA'],
  ['va', 'VA'],
  ['usda', 'USDA'],
  ['jumbo', 'Jumbo'],
  ['non_qm_dscr', 'Non-QM · DSCR'],
  ['non_qm_bank_statement', 'Non-QM · Bank statement'],
  ['non_qm_other', 'Non-QM · Other'],
  ['dpa', 'Down payment assistance'],
] as const
export type BrowseGroup = (typeof BROWSE_GROUPS)[number][0]
export const BROWSE_GROUP_LABEL = Object.fromEntries(BROWSE_GROUPS) as Record<BrowseGroup, string>

export function browseGroup(p: CatalogProgram): BrowseGroup {
  if (isDpaProgram(p)) return 'dpa'
  if (p.family !== 'non_qm') return p.family
  if (p.docTypes.includes('dscr')) return 'non_qm_dscr'
  if (p.docTypes.some((d) => d === 'bank_statement_12' || d === 'bank_statement_24')) return 'non_qm_bank_statement'
  return 'non_qm_other'
}

export interface ProgramSummary {
  /** Lowest credit score any offered cell takes. */
  minFico: number | null
  /** Highest LTV (1st liens) or CLTV (2nds) any offered cell allows. */
  maxRatio: number | null
  ratio: 'LTV' | 'CLTV'
  /** Largest loan amount any offered cell covers; null = no upper limit printed. */
  maxLoan: number | null
  /** Lowest DSCR the matrix takes (DSCR programs). */
  minDscr: number | null
}

/** Headline numbers from the approved matrix (blank cells don't count). */
export function programSummary(p: CatalogProgram): ProgramSummary {
  const offered = p.cells.filter((c) => c.offered)
  const ratio = p.lien === 'first' ? 'LTV' : 'CLTV'
  const limit = (c: CatalogProgram['cells'][number]) => (ratio === 'LTV' ? (c.maxLtv ?? c.maxCltv) : (c.maxCltv ?? c.maxLtv)) ?? 0
  const dscrRule = p.rules.find((r) => r.field === 'dscr' && r.op === '>=' && typeof r.value === 'number')
  const dscrCells = offered.map((c) => c.dscrMin).filter((d): d is number => d != null)
  return {
    minFico: offered.length ? Math.min(...offered.map((c) => c.ficoMin)) : null,
    maxRatio: offered.length ? Math.max(...offered.map(limit)) : null,
    ratio,
    maxLoan: offered.length === 0 || offered.some((c) => c.loanAmountMax == null) ? null : Math.max(...offered.map((c) => c.loanAmountMax!)),
    minDscr: dscrCells.length ? Math.min(...dscrCells) : typeof dscrRule?.value === 'number' ? dscrRule.value : null,
  }
}

export interface BrowseFilters {
  /** Empty = every group. */
  groups: BrowseGroup[]
  liens: Lien[]
  statuses: LenderStatus[]
  /** Programs whose lowest credit score is at or below this. */
  ficoAtOrBelow: number | null
  /** Programs whose highest LTV/CLTV is at least this. */
  ltvAtLeast: number | null
  /** Words typed in the search box (program, lender or feature names). */
  text: string
  /** Programs whose guideline text matched the search (from the database); null = no guideline search. */
  guidelineHits: Set<string> | null
}

export const allBrowseFilters = (): BrowseFilters => ({ groups: [], liens: ['first', 'ces', 'heloc'], statuses: ['approved', 'pending', 'not_signed_up'], ficoAtOrBelow: null, ltvAtLeast: null, text: '', guidelineHits: null })

export interface BrowseRow {
  program: CatalogProgram
  lender: CatalogLender
  group: BrowseGroup
  summary: ProgramSummary
  /** Why it matched the search box: by name, or in its guidelines. */
  matchedBy: 'name' | 'guidelines' | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function textMatch(row: Omit<BrowseRow, 'matchedBy'>, words: string[], featureLabels: Record<string, string>) {
  const hay = norm([row.program.name, row.lender.name, ...row.program.features.map((f) => featureLabels[f] ?? f), BROWSE_GROUP_LABEL[row.group]].join(' '))
  return words.every((w) => hay.includes(w))
}

/** Active programs from lenders that aren't inactive, with what each filter says. */
export function browseRows(catalog: Catalog): Omit<BrowseRow, 'matchedBy'>[] {
  const lenders = new Map(catalog.lenders.map((l) => [l.id, l]))
  return catalog.programs.flatMap((p) => {
    const lender = lenders.get(p.lenderId)
    if (!p.active || !lender || lender.status === 'inactive') return []
    return [{ program: p, lender, group: browseGroup(p), summary: programSummary(p) }]
  })
}

/** Every filter except the one named (so a filter's own counts show what picking another option would add). */
function passes(row: Omit<BrowseRow, 'matchedBy'>, f: BrowseFilters, words: string[], featureLabels: Record<string, string>, except: 'groups' | 'statuses' | null) {
  if (except !== 'groups' && f.groups.length && !f.groups.includes(row.group)) return false
  if (!f.liens.includes(row.program.lien)) return false
  if (except !== 'statuses' && !f.statuses.includes(row.lender.status)) return false
  if (f.ficoAtOrBelow != null && (row.summary.minFico == null || row.summary.minFico > f.ficoAtOrBelow)) return false
  if (f.ltvAtLeast != null && (row.summary.maxRatio == null || row.summary.maxRatio < f.ltvAtLeast)) return false
  if (words.length && !textMatch(row, words, featureLabels) && !f.guidelineHits?.has(row.program.id)) return false
  return true
}

export function filterBrowse(rows: Omit<BrowseRow, 'matchedBy'>[], f: BrowseFilters, featureLabels: Record<string, string> = {}): BrowseRow[] {
  const words = norm(f.text).split(' ').filter(Boolean)
  return rows.filter((r) => passes(r, f, words, featureLabels, null)).map((r) => ({ ...r, matchedBy: !words.length ? null : textMatch(r, words, featureLabels) ? 'name' : 'guidelines' }))
}

/** How many programs each group and each lender status would show, given the other filters. */
export function browseCounts(rows: Omit<BrowseRow, 'matchedBy'>[], f: BrowseFilters, featureLabels: Record<string, string> = {}) {
  const words = norm(f.text).split(' ').filter(Boolean)
  const groups = Object.fromEntries(BROWSE_GROUPS.map(([g]) => [g, 0])) as Record<BrowseGroup, number>
  const statuses: Record<LenderStatus, number> = { approved: 0, pending: 0, not_signed_up: 0, inactive: 0 }
  for (const r of rows) {
    if (passes(r, f, words, featureLabels, 'groups')) groups[r.group]++
    if (passes(r, f, words, featureLabels, 'statuses')) statuses[r.lender.status]++
  }
  return { groups, statuses }
}

export type BrowseSort = 'type' | 'lender' | 'updated'

/** Grouped by product type (in filter order), or one list by lender or by most recently verified. */
export function groupBrowse(rows: BrowseRow[], sort: BrowseSort, verifiedOn: Map<string, string | null>): { group: BrowseGroup | null; rows: BrowseRow[] }[] {
  const byName = (a: BrowseRow, b: BrowseRow) => a.lender.name.localeCompare(b.lender.name) || a.program.name.localeCompare(b.program.name)
  if (sort === 'lender') return [{ group: null, rows: [...rows].sort(byName) }]
  if (sort === 'updated') return [{ group: null, rows: [...rows].sort((a, b) => (verifiedOn.get(b.program.id) ?? '').localeCompare(verifiedOn.get(a.program.id) ?? '') || byName(a, b)) }]
  return BROWSE_GROUPS.map(([g]) => ({ group: g as BrowseGroup, rows: rows.filter((r) => r.group === g).sort(byName) })).filter((x) => x.rows.length > 0)
}

/** A program as the drawer shows it when browsing (no scenario: nothing is judged, rules are listed). */
export function browseResult(row: Pick<BrowseRow, 'program' | 'lender' | 'summary'>): ProgramResult {
  return {
    program: row.program,
    lender: row.lender,
    eligible: false,
    cell: null,
    limit: null,
    maxLoan: row.summary.maxLoan,
    ficoFloor: row.summary.minFico,
    reasons: [],
    checklist: row.program.rules.map((r) => ({ message: r.message, status: 'na', value: null, trace: { ruleId: r.id, page: r.sourcePage }, overlay: !!r.overlay })),
    badges: [],
  }
}
