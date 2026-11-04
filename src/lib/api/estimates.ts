import { useQuery } from '@tanstack/react-query'
import type { FeeOverride, FeeSection, PaidBy } from '@/lib/calc'
import type { Estimate, EstimateDraft, EstimateProgram } from '@/lib/estimates/estimate'
import type { ProductFamily } from '@/lib/products/taxonomy'
import type { ScenarioDraft } from '@/lib/pricing/scenario'
import { db, keys, num, unwrap } from './client'
import { SCENARIO_SELECT, scenarioRow, toScenario } from './pricing'

// Estimates (Scenarios & Estimate): pricing_scenarios rows with their
// program, credits, saved fee rules, results and loan snapshot.

type ExtraKey = Exclude<keyof EstimateDraft, keyof ScenarioDraft>
/** App field → [column, kind]. */
const EXTRA_COLUMNS: Record<ExtraKey, [string, 'text' | 'number' | 'json']> = {
  programOptionId: ['program_option_id', 'text'],
  quoteDate: ['quote_date', 'text'],
  archivedAt: ['archived_at', 'text'],
  sellerCredits: ['seller_credits', 'number'],
  earnestMoney: ['earnest_money', 'number'],
  feeRules: ['fee_rules', 'json'],
  figures: ['figures', 'json'],
  loanSnapshot: ['loan_snapshot', 'json'],
  pricedAt: ['priced_at', 'text'],
  feesGeneratedAt: ['fees_generated_at', 'text'],
  fromLoanId: ['from_loan_id', 'text'],
}

const ESTIMATE_SELECT = `${SCENARIO_SELECT}, ${Object.values(EXTRA_COLUMNS).map(([c]) => c).join(', ')}, created_at, updated_at, option:loan_program_options(program_id, program:programs(name, product_family, lender:lenders(id, name, short_name)))`

interface OptionJoin {
  program_id: string
  program: { name: string; product_family: ProductFamily; lender: { id: string; name: string; short_name: string | null } | null } | null
}

function toEstimate(row: Record<string, unknown>): Estimate {
  const extras = Object.fromEntries(
    Object.entries(EXTRA_COLUMNS).map(([key, [column, kind]]) => [key, kind === 'number' ? num(row[column]) : (row[column] ?? null)]),
  ) as Pick<Estimate, ExtraKey>
  const o = row.option as OptionJoin | null
  const program: EstimateProgram | null = o?.program
    ? { programId: o.program_id, programName: o.program.name, family: o.program.product_family, lenderId: o.program.lender?.id ?? '', lenderName: o.program.lender?.name ?? '', lenderShortName: o.program.lender?.short_name ?? null }
    : null
  return { ...toScenario(row), ...extras, program, createdAt: row.created_at as string, updatedAt: row.updated_at as string }
}

/** Estimate fields as database columns (only the ones given). */
export function estimateRow(changes: Partial<EstimateDraft>): Record<string, unknown> {
  const base: Partial<ScenarioDraft> = {}
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(changes)) {
    if (key in EXTRA_COLUMNS) extra[EXTRA_COLUMNS[key as ExtraKey][0]] = value
    else (base as Record<string, unknown>)[key] = value
  }
  return { ...scenarioRow(base), ...extra }
}

/** Every estimate on the file, archived ones too, oldest first (the Scenarios & Estimate tab, and the assistant). */
export async function fetchEstimates(loanId: string): Promise<Estimate[]> {
  return unwrap<Record<string, unknown>[]>(await db().from('pricing_scenarios').select(ESTIMATE_SELECT).eq('loan_id', loanId).order('created_at')).map(toEstimate)
}

/** Every estimate on the file, archived ones too, oldest first. */
export function useEstimates(loanId: string) {
  return useQuery({
    queryKey: keys.pricingScenarios(loanId),
    queryFn: () => fetchEstimates(loanId),
  })
}

export async function createEstimate(draft: EstimateDraft, organizationId: string, fees: FeeOverride[] = []): Promise<Estimate> {
  const created = toEstimate(unwrap<Record<string, unknown>>(await db().from('pricing_scenarios').insert({ ...estimateRow(draft), organization_id: organizationId }).select(ESTIMATE_SELECT).single()))
  if (fees.length) await saveFees(created, organizationId, fees)
  return created
}

export async function updateEstimate(id: string, changes: Partial<EstimateDraft>): Promise<void> {
  const row = estimateRow(changes)
  if (Object.keys(row).length === 0) return
  const rows = unwrap<{ id: string }[]>(await db().from('pricing_scenarios').update(row).eq('id', id).select('id'))
  if (rows.length === 0) throw new Error('You do not have permission to change this estimate.')
}

// ---------------------------------------------------------------------------
// Fee edits (loan_fees), for every estimate on the file at once
// ---------------------------------------------------------------------------

interface FeeRow {
  pricing_scenario_id: string
  fee_key: string
  section: FeeSection
  name: string
  at_closing: unknown
  before_closing: unknown
  paid_by: PaidBy
  apr: boolean
  paid_to: string | null
  is_custom: boolean
}

export const loanFeesKey = (loanId: string) => ['loanFees', loanId] as const

/** Each estimate's fee edits, by estimate id. */
/** Every fee edit on a file's estimates, by estimate (the Estimate tool and the assistant). */
export async function fetchLoanFees(loanId: string): Promise<Map<string, FeeOverride[]>> {
      const rows = unwrap<FeeRow[]>(await db().from('loan_fees').select('pricing_scenario_id, fee_key, section, name, at_closing, before_closing, paid_by, apr, paid_to, is_custom').eq('loan_id', loanId).order('created_at'))
      const out = new Map<string, FeeOverride[]>()
      for (const r of rows) {
        const list = out.get(r.pricing_scenario_id) ?? []
        list.push({ key: r.fee_key, section: r.section, name: r.name, atClosing: num(r.at_closing), beforeClosing: num(r.before_closing), paidBy: r.paid_by, apr: r.apr, paidTo: r.paid_to, custom: r.is_custom })
        out.set(r.pricing_scenario_id, list)
      }
      return out
}

export function useLoanFees(loanId: string) {
  return useQuery({
    queryKey: loanFeesKey(loanId),
    queryFn: () => fetchLoanFees(loanId),
  })
}

/** Saves fee edits on one estimate (each replaces an earlier edit of the same fee). */
export async function saveFees(estimate: { id: string; loanId: string }, organizationId: string, fees: FeeOverride[]): Promise<void> {
  if (!fees.length) return
  unwrap(
    await db()
      .from('loan_fees')
      .upsert(
        fees.map((o) => ({
          organization_id: organizationId,
          loan_id: estimate.loanId,
          pricing_scenario_id: estimate.id,
          fee_key: o.key,
          section: o.section,
          name: o.name,
          at_closing: o.atClosing,
          before_closing: o.beforeClosing,
          paid_by: o.paidBy,
          apr: o.apr,
          paid_to: o.paidTo,
          is_custom: o.custom,
        })),
        { onConflict: 'pricing_scenario_id,fee_key' },
      )
      .select('id'),
  )
}

/** Removes one fee edit (back to the calculated amount) or an added fee; with no key, every edit ("Reset all"). */
export async function resetFees(estimateId: string, feeKey?: string): Promise<void> {
  let q = db().from('loan_fees').delete().eq('pricing_scenario_id', estimateId)
  if (feeKey) q = q.eq('fee_key', feeKey)
  unwrap(await q.select('id'))
}

/**
 * A closed loan's estimates, copied to the new file made from it (refi or
 * next purchase) as Drafts marked "From previous loan", with their fee edits
 * and saved figures. The program link and home belong to the old file, so
 * they're kept by name only.
 */
export async function copyEstimatesTo(fromLoanId: string, toLoanId: string, organizationId: string): Promise<number> {
  const source = unwrap<Record<string, unknown>[]>(await db().from('pricing_scenarios').select(ESTIMATE_SELECT).eq('loan_id', fromLoanId).is('archived_at', null).order('created_at')).map(toEstimate)
  const { data: feeRows } = await db().from('loan_fees').select('pricing_scenario_id, fee_key, section, name, at_closing, before_closing, paid_by, apr, paid_to, is_custom').eq('loan_id', fromLoanId)
  for (const e of source) {
    const { id, program, createdAt: _c, updatedAt: _u, ...draft } = e
    const row = estimateRow({ ...draft, loanId: toLoanId, propertyId: null, programOptionId: null, fromLoanId, lenderName: draft.lenderName ?? program?.lenderShortName ?? program?.lenderName ?? null, programName: draft.programName ?? program?.programName ?? null })
    const created = unwrap<{ id: string }>(await db().from('pricing_scenarios').insert({ ...row, organization_id: organizationId }).select('id').single())
    const fees = ((feeRows ?? []) as FeeRow[]).filter((f) => f.pricing_scenario_id === id)
    if (fees.length) unwrap(await db().from('loan_fees').insert(fees.map((f) => ({ ...f, organization_id: organizationId, loan_id: toLoanId, pricing_scenario_id: created.id }))).select('id'))
  }
  return source.length
}

// ---------------------------------------------------------------------------
// Programs on the file
// ---------------------------------------------------------------------------

export interface ProgramListItem {
  id: string
  name: string
  family: ProductFamily
  lien: string
  active: boolean
  lenderId: string
  lenderName: string
  lenderStatus: string
}

/** Every program with its lender, for Build estimates (names only, without the matrices Product Search loads). */
/** Every program in the catalog with its lender (Build estimates' list, and the assistant). */
export async function fetchProgramList(): Promise<ProgramListItem[]> {
  return unwrap<{ id: string; name: string; product_family: ProductFamily; lien: string; active: boolean; lender: { id: string; name: string; short_name: string | null; status: string } | null }[]>(
        await db().from('programs').select('id, name, product_family, lien, active, lender:lenders(id, name, short_name, status)').order('name'),
      ).map((p): ProgramListItem => ({ id: p.id, name: p.name, family: p.product_family, lien: p.lien, active: p.active, lenderId: p.lender?.id ?? '', lenderName: p.lender?.short_name ?? p.lender?.name ?? '', lenderStatus: p.lender?.status ?? '' }))
}

export function useProgramList() {
  return useQuery({
    queryKey: ['programList'],
    staleTime: 5 * 60_000,
    queryFn: fetchProgramList,
  })
}

/** Puts a program on the file as a new option, even when it's already there (the same program priced another way). */
export async function newProgramOption(loanId: string, organizationId: string, programId: string): Promise<string> {
  return unwrap<{ id: string }>(await db().from('loan_program_options').insert({ organization_id: organizationId, loan_id: loanId, program_id: programId, status: 'quoted', sort_order: 100 }).select('id').single()).id
}
