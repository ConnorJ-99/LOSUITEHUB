import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import type { Catalog, CatalogLender, CatalogProgram, MatrixCell, ProgramRule, Scenario, SearchResult } from '@/lib/products/types'
import { db, keys, num, unwrap } from './client'

// ---------------------------------------------------------------------------
// Rows → catalog (pure, tested)
// ---------------------------------------------------------------------------

export interface LenderRow {
  id: string
  name: string
  status: CatalogLender['status']
  states: string[] | null
}

export interface ProgramRow {
  id: string
  lender_id: string
  name: string
  product_family: CatalogProgram['family']
  lien: CatalogProgram['lien']
  doc_types: CatalogProgram['docTypes']
  features: CatalogProgram['features']
  purposes: CatalogProgram['purposes']
  loan_amount_basis: CatalogProgram['loanAmountBasis']
  active: boolean
  last_verified_on: string | null
}

export interface CellRow {
  id: string
  matrix_version_id: string
  occupancy: MatrixCell['occupancy']
  property_types: MatrixCell['propertyTypes']
  purposes: MatrixCell['purposes']
  doc_type: MatrixCell['docType']
  units_min: number
  units_max: number
  fico_min: number
  fico_max: number
  loan_amount_min: unknown
  loan_amount_max: unknown
  dscr_min: unknown
  citizenship: MatrixCell['citizenship']
  offered: boolean
  max_ltv: unknown
  max_cltv: unknown
  max_dti: unknown
  reserves_months: number | null
  source_page: number | null
  notes: string | null
}

export interface RuleRow {
  id: string
  program_id?: string
  matrix_version_id?: string | null
  scope?: 'all' | 'lender' | 'program'
  lender_id?: string | null
  field: ProgramRule['field']
  op: ProgramRule['op']
  value: ProgramRule['value']
  applies_when: ProgramRule['appliesWhen']
  severity: ProgramRule['severity']
  message: string
  source_page?: number | null
  source_quote?: string | null
}

export interface VersionRow {
  id: string
  program_id: string
}

const toCell = (c: CellRow): MatrixCell => ({
  id: c.id,
  occupancy: c.occupancy,
  propertyTypes: c.property_types,
  purposes: c.purposes,
  docType: c.doc_type,
  unitsMin: c.units_min,
  unitsMax: c.units_max,
  ficoMin: c.fico_min,
  ficoMax: c.fico_max,
  loanAmountMin: num(c.loan_amount_min) ?? 0,
  loanAmountMax: num(c.loan_amount_max),
  dscrMin: num(c.dscr_min),
  citizenship: c.citizenship,
  offered: c.offered,
  maxLtv: num(c.max_ltv),
  maxCltv: num(c.max_cltv),
  maxDti: num(c.max_dti),
  reservesMonths: c.reserves_months,
  sourcePage: c.source_page,
  notes: c.notes,
})

const toRule = (r: RuleRow, overlay = false): ProgramRule => ({
  id: r.id,
  field: r.field,
  op: r.op,
  value: r.value,
  appliesWhen: r.applies_when,
  severity: r.severity,
  message: r.message,
  sourcePage: r.source_page ?? null,
  sourceQuote: r.source_quote ?? null,
  overlay,
})

export interface CatalogRows {
  lenders: LenderRow[]
  programs: ProgramRow[]
  /** Approved matrix versions only. */
  versions: VersionRow[]
  cells: CellRow[]
  rules: RuleRow[]
  overlays: RuleRow[]
}

/** Builds the engine's catalog: each program gets its approved version's cells, its rules (program-wide or from that version) and lender/program overlays. */
export function toCatalog(rows: CatalogRows): Catalog & { verifiedOn: Map<string, string | null> } {
  const approved = new Map(rows.versions.map((v) => [v.id, v.program_id]))
  const cellsBy = new Map<string, MatrixCell[]>()
  for (const c of rows.cells) {
    const programId = approved.get(c.matrix_version_id)
    if (!programId) continue
    cellsBy.set(programId, [...(cellsBy.get(programId) ?? []), toCell(c)])
  }
  const approvedVersionOf = new Map(rows.versions.map((v) => [v.program_id, v.id]))
  const rulesBy = new Map<string, ProgramRule[]>()
  for (const r of rows.rules) {
    if (!r.program_id) continue
    // A rule tied to a matrix version counts only while that version is the approved one.
    if (r.matrix_version_id && approvedVersionOf.get(r.program_id) !== r.matrix_version_id) continue
    rulesBy.set(r.program_id, [...(rulesBy.get(r.program_id) ?? []), toRule(r)])
  }
  const programs: CatalogProgram[] = rows.programs.map((p) => ({
    id: p.id,
    lenderId: p.lender_id,
    name: p.name,
    family: p.product_family,
    lien: p.lien,
    docTypes: p.doc_types,
    features: p.features,
    purposes: p.purposes,
    loanAmountBasis: p.loan_amount_basis,
    active: p.active,
    cells: cellsBy.get(p.id) ?? [],
    rules: [
      ...(rulesBy.get(p.id) ?? []),
      ...rows.overlays.filter((o) => (o.scope === 'lender' && o.lender_id === p.lender_id) || (o.scope === 'program' && o.program_id === p.id)).map((o) => toRule(o, true)),
    ],
  }))
  return {
    lenders: rows.lenders.map((l) => ({ id: l.id, name: l.name, status: l.status, states: l.states })),
    programs,
    overlays: rows.overlays.filter((o) => o.scope === 'all').map((o) => toRule(o, true)),
    verifiedOn: new Map(rows.programs.map((p) => [p.id, p.last_verified_on])),
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const PAGE = 1000

/** Reads every row of a query, a page at a time (Supabase returns at most 1,000 per request). */
async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const page = unwrap<T[]>(await query(from, from + PAGE - 1))
    all.push(...page)
    if (page.length < PAGE) return all
  }
}

/** The company's whole lender catalog, approved matrices only. One load; every search after that is in memory. */
export function useCatalog() {
  return useQuery({
    queryKey: keys.catalog,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [lenders, programs, versions, rules, overlays] = await Promise.all([
        readAll<LenderRow>((a, b) => db().from('lenders').select('id, name, status, states').order('name').range(a, b)),
        readAll<ProgramRow>((a, b) => db().from('programs').select('id, lender_id, name, product_family, lien, doc_types, features, purposes, loan_amount_basis, active, last_verified_on').order('name').range(a, b)),
        readAll<VersionRow>((a, b) => db().from('matrix_versions').select('id, program_id').eq('status', 'approved').range(a, b)),
        readAll<RuleRow>((a, b) => db().from('program_rules').select('id, program_id, matrix_version_id, field, op, value, applies_when, severity, message, source_page, source_quote').order('created_at').range(a, b)),
        readAll<RuleRow & { program_id: string | null }>((a, b) => db().from('overlays').select('id, scope, lender_id, program_id, field, op, value, applies_when, severity, message').eq('active', true).range(a, b)),
      ])
      const cells = await readAll<CellRow>((a, b) =>
        db()
          .from('program_matrix_cells')
          .select('id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, dscr_min, citizenship, offered, max_ltv, max_cltv, max_dti, reserves_months, source_page, notes, matrix_versions!inner(status)')
          .eq('matrix_versions.status', 'approved')
          .order('id')
          .range(a, b),
      )
      return toCatalog({ lenders, programs, versions, cells, rules, overlays: overlays.map((o) => ({ ...o, program_id: o.program_id ?? undefined })) })
    },
  })
}

// ---------------------------------------------------------------------------
// Search log (Recent searches)
// ---------------------------------------------------------------------------

export interface RecentSearch {
  id: string
  scenario: Scenario
  loanId: string | null
  fits: number
  close: number
  createdAt: string
}

export function useRecentSearches() {
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null
  return useQuery({
    queryKey: keys.recentSearches,
    enabled: !!userId,
    queryFn: async () =>
      unwrap<{ id: string; scenario: Scenario; loan_id: string | null; results: { fits?: number; close?: number }; created_at: string }[]>(
        await db().from('product_searches').select('id, scenario, loan_id, results, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(5),
      ).map((r): RecentSearch => ({ id: r.id, scenario: r.scenario, loanId: r.loan_id, fits: r.results.fits ?? 0, close: r.results.close ?? 0, createdAt: r.created_at })),
  })
}

/** What a search returned, by program, with the cell or rule each one traced to. */
export function searchLog(result: SearchResult) {
  return {
    fits: result.eligible.length,
    close: result.ineligible.filter((r) => r.reasons.every((x) => !x.unfixable)).length,
    eligible: result.eligible.map((r) => ({ program: r.program.id, cell: r.cell?.id ?? null, page: r.cell?.sourcePage ?? null })),
    ineligible: result.ineligible.map((r) => ({ program: r.program.id, reasons: r.reasons.map((x) => ({ kind: x.kind, message: x.message, cell: x.trace?.cellId ?? null, rule: x.trace?.ruleId ?? null, page: x.trace?.page ?? null })) })),
  }
}

export function useLogSearch() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async ({ scenario, result, loanId }: { scenario: Scenario; result: SearchResult; loanId: string | null }) => {
      unwrap(
        await db()
          .from('product_searches')
          .insert({ organization_id: orgId, loan_id: loanId, source: 'form', scenario, searched_count: result.searchedCount, not_searched_count: result.notSearched.count, results: searchLog(result) })
          .select('id'),
      )
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.recentSearches }),
  })
}
