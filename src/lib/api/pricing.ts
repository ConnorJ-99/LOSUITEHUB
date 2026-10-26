import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import type { AmountType, FeeOverride, FeeSection, FeeTemplate, PaidBy } from '@/lib/calc'
import type { PricingScenario, ScenarioDraft } from '@/lib/pricing/scenario'
import { db, keys, num, unwrap } from './client'

// ---------------------------------------------------------------------------
// The company fee list (Settings)
// ---------------------------------------------------------------------------

export interface SavedFeeTemplate extends FeeTemplate {
  id: string
}

interface TemplateRow {
  id: string
  key: string
  section: FeeTemplate['section']
  name: string
  amount_type: AmountType
  amount: unknown
  purposes: string[] | null
  mortgage_types: string[] | null
  paid_by: PaidBy
  apr: boolean
  paid_to: string | null
  sort_order: number
  active: boolean
}

export const FEE_SECTION_LABEL: Record<FeeSection, string> = {
  A: 'A. Origination charges',
  B: "B. Services you can't shop for",
  C: 'C. Services you can shop for',
  E: 'E. Taxes and government fees',
  F: 'F. Prepaids',
  G: 'G. Initial escrow payment at closing',
  H: 'H. Other',
}

export const AMOUNT_TYPE_LABEL: Record<AmountType, string> = { fixed: 'Dollar amount', pct_loan: '% of loan amount', pct_value: '% of price or value' }
export const PAID_BY_LABEL: Record<PaidBy, string> = { B: 'Borrower', S: 'Seller', L: 'Lender', O: 'Other' }

/** The fee list, in order. Empty until fees are added (or before the fees script is run). */
export function useFeeTemplates() {
  return useQuery({
    queryKey: keys.feeTemplates,
    queryFn: async (): Promise<SavedFeeTemplate[]> =>
      unwrap<TemplateRow[]>(await db().from('fee_templates').select('id, key, section, name, amount_type, amount, purposes, mortgage_types, paid_by, apr, paid_to, sort_order, active').order('section').order('sort_order')).map((r) => ({
        id: r.id,
        key: r.key,
        section: r.section,
        name: r.name,
        amountType: r.amount_type,
        amount: num(r.amount) ?? 0,
        purposes: r.purposes,
        mortgageTypes: r.mortgage_types,
        paidBy: r.paid_by,
        apr: r.apr,
        paidTo: r.paid_to,
        sortOrder: r.sort_order,
        active: r.active,
      })),
  })
}

export type FeeTemplateDraft = Omit<FeeTemplate, 'key'> & { id: string | null; key: string | null }

/** A key from the fee name: "Title - Lender's Policy" → "title_lender_s_policy". */
export const feeKeyFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'fee'

export function useSaveFeeTemplate() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (f: FeeTemplateDraft) => {
      if (!f.name.trim()) throw new Error('A fee needs a name.')
      const row = {
        section: f.section,
        name: f.name.trim(),
        amount_type: f.amountType,
        amount: f.amount,
        purposes: f.purposes?.length ? f.purposes : null,
        mortgage_types: f.mortgageTypes?.length ? f.mortgageTypes : null,
        paid_by: f.paidBy,
        apr: f.apr,
        paid_to: f.paidTo?.trim() || null,
        sort_order: f.sortOrder,
        active: f.active,
      }
      const result = f.id
        ? await db().from('fee_templates').update(row).eq('id', f.id).select('id')
        : await db().from('fee_templates').insert({ ...row, organization_id: orgId, key: feeKeyFrom(f.name) }).select('id')
      if (result.error?.code === '23505') throw new Error('A fee with that name is already on the list.')
      if (unwrap<{ id: string }[]>(result).length === 0) throw new Error('Only owners and admins can change the fee list.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.feeTemplates }),
  })
}

export function useDeleteFeeTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('fee_templates').delete().eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('Only owners and admins can delete fees.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.feeTemplates }),
  })
}

// ---------------------------------------------------------------------------
// Pricing scenarios on a file
// ---------------------------------------------------------------------------

/** App field → [column, numeric]. */
const SCENARIO_COLUMNS: Record<keyof ScenarioDraft, [string, boolean]> = {
  loanId: ['loan_id', false],
  propertyId: ['property_id', false],
  name: ['name', false],
  lenderName: ['lender_name', false],
  programName: ['program_name', false],
  mortgageType: ['mortgage_type', false],
  amortizationType: ['amortization_type', false],
  interestOnly: ['interest_only', false],
  termMonths: ['term_months', true],
  noteRate: ['note_rate', true],
  qualifyingRate: ['qualifying_rate', true],
  buydown: ['buydown', false],
  lockDays: ['lock_days', true],
  loanAmount: ['loan_amount', true],
  purchasePrice: ['purchase_price', true],
  propertyValue: ['property_value', true],
  taxesValue: ['taxes_value', true],
  taxesFactor: ['taxes_factor', false],
  insuranceValue: ['insurance_value', true],
  insuranceFactor: ['insurance_factor', false],
  supplementalInsuranceMonthly: ['supplemental_insurance_monthly', true],
  monthlyHoa: ['monthly_hoa', true],
  monthlyMi: ['monthly_mi', true],
  otherPaymentMonthly: ['other_payment_monthly', true],
  otherPaymentLabel: ['other_payment_label', false],
  impoundWaiver: ['impound_waiver', false],
  estimatedFundingDate: ['estimated_funding_date', false],
  firstPaymentDate: ['first_payment_date', false],
  pointsPct: ['points_pct', true],
  lenderCredit: ['lender_credit', true],
  prepaidInterestDays: ['prepaid_interest_days', true],
  hoiPrepaidMonths: ['hoi_prepaid_months', true],
  taxPrepaidMonths: ['tax_prepaid_months', true],
  hoiReserveMonths: ['hoi_reserve_months', true],
  taxReserveMonths: ['tax_reserve_months', true],
  miReserveMonths: ['mi_reserve_months', true],
  aggregateAdjustment: ['aggregate_adjustment', true],
  notes: ['notes', false],
}
const NOT_NULL_NUMBERS = new Set<keyof ScenarioDraft>(['pointsPct', 'lenderCredit', 'aggregateAdjustment'])
const SCENARIO_SELECT = `id, ${Object.values(SCENARIO_COLUMNS).map(([c]) => c).join(', ')}`

function toScenario(row: Record<string, unknown>): PricingScenario {
  const fields = Object.fromEntries(
    Object.entries(SCENARIO_COLUMNS).map(([key, [column, numeric]]) => [key, numeric ? (num(row[column]) ?? (NOT_NULL_NUMBERS.has(key as keyof ScenarioDraft) ? 0 : null)) : (row[column] ?? null)]),
  )
  return { id: row.id as string, ...fields } as PricingScenario
}

/** Scenario fields as database columns (only the ones given). */
export function scenarioRow(changes: Partial<ScenarioDraft>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).map(([key, value]) => [SCENARIO_COLUMNS[key as keyof ScenarioDraft][0], value]))
}

export function usePricingScenarios(loanId: string) {
  return useQuery({
    queryKey: keys.pricingScenarios(loanId),
    queryFn: async () => unwrap<Record<string, unknown>[]>(await db().from('pricing_scenarios').select(SCENARIO_SELECT).eq('loan_id', loanId).order('created_at')).map(toScenario),
  })
}

export function useCreateScenario(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draft: ScenarioDraft) =>
      toScenario(unwrap<Record<string, unknown>>(await db().from('pricing_scenarios').insert({ ...scenarioRow(draft), organization_id: organizationId }).select(SCENARIO_SELECT).single())),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.pricingScenarios(loanId) }),
  })
}

export function useUpdateScenario(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Partial<ScenarioDraft> }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('pricing_scenarios').update(scenarioRow(changes)).eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('You do not have permission to change this scenario.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.pricingScenarios(loanId) }),
  })
}

export function useDeleteScenario(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('pricing_scenarios').delete().eq('id', id).select('id'))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.pricingScenarios(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.loan(loanId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Fee edits on a scenario
// ---------------------------------------------------------------------------

interface FeeRow {
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

export function useScenarioFees(scenarioId: string | null) {
  return useQuery({
    queryKey: keys.scenarioFees(scenarioId ?? ''),
    enabled: !!scenarioId,
    queryFn: async (): Promise<FeeOverride[]> =>
      unwrap<FeeRow[]>(await db().from('loan_fees').select('fee_key, section, name, at_closing, before_closing, paid_by, apr, paid_to, is_custom').eq('pricing_scenario_id', scenarioId).order('created_at')).map((r) => ({
        key: r.fee_key,
        section: r.section,
        name: r.name,
        atClosing: num(r.at_closing),
        beforeClosing: num(r.before_closing),
        paidBy: r.paid_by,
        apr: r.apr,
        paidTo: r.paid_to,
        custom: r.is_custom,
      })),
  })
}

/** Saves an edit to one fee (or an added fee), replacing any earlier edit of it. */
export function useSaveFee(scenario: { id: string; loanId: string }, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (o: FeeOverride) => {
      unwrap(
        await db()
          .from('loan_fees')
          .upsert(
            {
              organization_id: organizationId,
              loan_id: scenario.loanId,
              pricing_scenario_id: scenario.id,
              fee_key: o.key,
              section: o.section,
              name: o.name,
              at_closing: o.atClosing,
              before_closing: o.beforeClosing,
              paid_by: o.paidBy,
              apr: o.apr,
              paid_to: o.paidTo,
              is_custom: o.custom,
            },
            { onConflict: 'pricing_scenario_id,fee_key' },
          )
          .select('id'),
      )
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.scenarioFees(scenario.id) }),
  })
}

/** Removes an edit (back to the calculated fee) or an added fee. */
export function useResetFee(scenarioId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (feeKey: string) => {
      unwrap(await db().from('loan_fees').delete().eq('pricing_scenario_id', scenarioId).eq('fee_key', feeKey).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.scenarioFees(scenarioId) }),
  })
}

/** Starts a scenario with the same numbers and fee edits as another. */
export async function copyScenario(source: PricingScenario, name: string, organizationId: string): Promise<PricingScenario> {
  const { id, ...draft } = source
  const created = toScenario(unwrap<Record<string, unknown>>(await db().from('pricing_scenarios').insert({ ...scenarioRow({ ...draft, name }), organization_id: organizationId }).select(SCENARIO_SELECT).single()))
  const fees = unwrap<Record<string, unknown>[]>(await db().from('loan_fees').select('fee_key, section, name, at_closing, before_closing, paid_by, apr, paid_to, is_custom').eq('pricing_scenario_id', id))
  if (fees.length) unwrap(await db().from('loan_fees').insert(fees.map((f) => ({ ...f, organization_id: organizationId, loan_id: source.loanId, pricing_scenario_id: created.id }))).select('id'))
  return created
}
