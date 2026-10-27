import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SavedQuote } from '@/lib/pricing/compare'
import type { DocType, LenderStatus, Lien, ProductFamily } from '@/lib/products/taxonomy'
import { db, keys, num, unwrap } from './client'

/** A program added to the borrower's file for pricing, with its quotes (one per pricing scenario). */
export interface ProgramOption {
  id: string
  programId: string
  programName: string
  family: ProductFamily
  lien: Lien
  docTypes: DocType[]
  lenderId: string
  lenderName: string
  lenderShortName: string | null
  lenderStatus: LenderStatus
  status: 'shortlisted' | 'quoted' | 'chosen' | 'removed'
  quotes: SavedQuote[]
}

interface QuoteRow {
  id: string
  option_id: string
  pricing_scenario_id: string
  rate: unknown
  lock_days: number | null
  points_pct: unknown
  lender_credit: unknown
  closing_costs: unknown
  closing_costs_from_fee_sheet: boolean
  monthly_mi: unknown
  quote_date: string
  notes: string | null
}

interface OptionRow {
  id: string
  program_id: string
  status: ProgramOption['status']
  sort_order: number
  program: { name: string; product_family: ProductFamily; lien: Lien; doc_types: DocType[]; lender: { id: string; name: string; short_name: string | null; status: LenderStatus } | null } | null
  loan_quotes: QuoteRow[]
}

const toQuote = (q: QuoteRow): SavedQuote => ({
  id: q.id,
  optionId: q.option_id,
  pricingScenarioId: q.pricing_scenario_id,
  rate: num(q.rate) ?? 0,
  lockDays: q.lock_days,
  pointsPct: num(q.points_pct) ?? 0,
  lenderCredit: num(q.lender_credit) ?? 0,
  closingCosts: num(q.closing_costs),
  closingCostsFromFeeSheet: q.closing_costs_from_fee_sheet,
  monthlyMi: num(q.monthly_mi),
  quoteDate: q.quote_date,
  notes: q.notes,
})

export function useProgramOptions(loanId: string) {
  return useQuery({
    queryKey: keys.programOptions(loanId),
    queryFn: async () =>
      unwrap<OptionRow[]>(
        await db()
          .from('loan_program_options')
          .select('id, program_id, status, sort_order, program:programs(name, product_family, lien, doc_types, lender:lenders(id, name, short_name, status)), loan_quotes(id, option_id, pricing_scenario_id, rate, lock_days, points_pct, lender_credit, closing_costs, closing_costs_from_fee_sheet, monthly_mi, quote_date, notes)')
          .eq('loan_id', loanId)
          .neq('status', 'removed')
          .order('sort_order')
          .order('created_at'),
      ).map(
        (o): ProgramOption => ({
          id: o.id,
          programId: o.program_id,
          programName: o.program?.name ?? 'Program',
          family: o.program?.product_family ?? 'conventional',
          lien: o.program?.lien ?? 'first',
          docTypes: o.program?.doc_types ?? [],
          lenderId: o.program?.lender?.id ?? '',
          lenderName: o.program?.lender?.name ?? '',
          lenderShortName: o.program?.lender?.short_name ?? null,
          lenderStatus: o.program?.lender?.status ?? 'approved',
          status: o.status,
          quotes: o.loan_quotes.map(toQuote),
        }),
      ),
  })
}

/** Adds programs to the borrower's file for pricing (ones already there are left as they are; removed ones come back). */
export async function addProgramOptions(loanId: string, organizationId: string, programIds: string[], searchId: string | null): Promise<number> {
  const existing = unwrap<{ program_id: string; status: string }[]>(await db().from('loan_program_options').select('program_id, status').eq('loan_id', loanId))
  const back = existing.filter((e) => e.status === 'removed' && programIds.includes(e.program_id)).map((e) => e.program_id)
  if (back.length) unwrap(await db().from('loan_program_options').update({ status: 'shortlisted' }).eq('loan_id', loanId).in('program_id', back).select('id'))
  const have = new Set(existing.map((e) => e.program_id))
  const fresh = programIds.filter((p) => !have.has(p))
  if (fresh.length) unwrap(await db().from('loan_program_options').insert(fresh.map((program_id, i) => ({ organization_id: organizationId, loan_id: loanId, program_id, search_id: searchId, sort_order: 100 + i }))).select('id'))
  return fresh.length + back.length
}

export function useAddProgramOptions(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ programIds, searchId }: { programIds: string[]; searchId: string | null }) => addProgramOptions(loanId, organizationId, programIds, searchId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.programOptions(loanId) }),
  })
}

/** Takes a program off the comparison (its quotes are kept with it, and come back if it's added again). */
export function useRemoveProgramOption(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (optionId: string) => {
      unwrap(await db().from('loan_program_options').update({ status: 'removed' }).eq('id', optionId).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.programOptions(loanId) }),
  })
}

export type QuoteDraft = Omit<SavedQuote, 'id'>

/** Saves a lender's quote for one pricing scenario (replacing an earlier one for the same scenario). */
export function useSaveQuote(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (q: QuoteDraft) => {
      if (!(q.rate > 0)) throw new Error('Enter the rate.')
      if (!q.closingCostsFromFeeSheet && q.closingCosts == null) throw new Error('Enter the total closing costs, or use the fee sheet.')
      unwrap(
        await db()
          .from('loan_quotes')
          .upsert(
            {
              organization_id: organizationId,
              loan_id: loanId,
              option_id: q.optionId,
              pricing_scenario_id: q.pricingScenarioId,
              rate: q.rate,
              lock_days: q.lockDays,
              points_pct: q.pointsPct,
              lender_credit: q.lenderCredit,
              closing_costs: q.closingCostsFromFeeSheet ? null : q.closingCosts,
              closing_costs_from_fee_sheet: q.closingCostsFromFeeSheet,
              monthly_mi: q.monthlyMi,
              quote_date: q.quoteDate,
              notes: q.notes,
            },
            { onConflict: 'option_id,pricing_scenario_id' },
          )
          .select('id'),
      )
      unwrap(await db().from('loan_program_options').update({ status: 'quoted' }).eq('id', q.optionId).eq('status', 'shortlisted').select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.programOptions(loanId) }),
  })
}

/** Marks one option as chosen (and any earlier choice as just quoted). The loan's own fields are written by the caller. */
export async function markChosen(loanId: string, optionId: string) {
  unwrap(await db().from('loan_program_options').update({ status: 'quoted' }).eq('loan_id', loanId).eq('status', 'chosen').neq('id', optionId).select('id'))
  unwrap(await db().from('loan_program_options').update({ status: 'chosen' }).eq('id', optionId).select('id'))
}
