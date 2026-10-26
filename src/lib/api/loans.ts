import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import type { LoanPurpose, PipelineStage } from '@/lib/pipeline/stages'
import { db, keys, num, unwrap } from './client'
import type { Contact, LoanDetails, LoanProfile, OrgMember, PipelineLoan, StageHistoryEntry } from './types'

// ---------------------------------------------------------------------------
// Row shapes returned by Supabase, and mappers to the app's types
// ---------------------------------------------------------------------------

interface ContactRow {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
}

interface LoanRow {
  id: string
  purpose: LoanPurpose
  stage: PipelineStage
  lost_reason: string | null
  referral_source: string | null
  stage_changed_at: string
  created_at: string
  prior_loan_id: string | null
  assigned_lo: { id: string; full_name: string | null; email: string } | null
  borrowers: { role: 'primary' | 'co_borrower'; contact: ContactRow | null }[]
}

const LOAN_SELECT = `
  id, purpose, stage, lost_reason, referral_source, stage_changed_at, created_at, prior_loan_id,
  assigned_lo:profiles!loans_assigned_lo_id_fkey ( id, full_name, email ),
  borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( id, first_name, last_name, email, phone ) )
`

/**
 * Every deal-fact column on loans: [database column, is it numeric?].
 * The profile query, the row conversion and the save all come from this list.
 */
const DETAIL_COLUMNS: Record<keyof LoanDetails, [string, boolean]> = {
  occupancy: ['occupancy', false],
  purchasePrice: ['purchase_price', true],
  loanAmount: ['loan_amount', true],
  noteRate: ['note_rate', true],
  termMonths: ['term_months', true],
  cashOutAmount: ['cash_out_amount', true],
  contractDate: ['contract_date', false],
  optionEndDate: ['option_end_date', false],
  closingDate: ['closing_date', false],
  vestingEntity: ['vesting_entity', false],
  financedPropertiesCount: ['financed_properties_count', true],
  subjectPropertyId: ['subject_property_id', false],
  mortgageType: ['mortgage_type', false],
  amortizationType: ['amortization_type', false],
  titleNames: ['title_names', false],
  titleManner: ['title_manner', false],
  estateType: ['estate_type', false],
  hasBalloon: ['has_balloon', false],
  hasInterestOnly: ['has_interest_only', false],
  hasNegativeAmortization: ['has_negative_amortization', false],
  hasPrepaymentPenalty: ['has_prepayment_penalty', false],
  improvementsAmount: ['improvements_amount', true],
  estimatedClosingCosts: ['estimated_closing_costs', true],
  prepaidItemsAmount: ['prepaid_items_amount', true],
  discountPointsAmount: ['discount_points_amount', true],
  sellerCredits: ['seller_credits', true],
  lenderCredits: ['lender_credits', true],
  estimatedTaxRatePct: ['estimated_tax_rate_pct', true],
  estimatedAnnualInsurance: ['estimated_annual_insurance', true],
  estimatedMonthlyHoa: ['estimated_monthly_hoa', true],
  miRatePct: ['mi_rate_pct', true],
  upfrontFeePct: ['upfront_fee_pct', true],
  ariveLoanNumber: ['arive_loan_number', false],
}

interface LoanProfileRow extends LoanRow {
  organization_id: string
  [column: string]: unknown
}

const PROFILE_SELECT = `${LOAN_SELECT}, organization_id, ${Object.values(DETAIL_COLUMNS).map(([c]) => c).join(', ')}`

export function toContact(row: ContactRow): Contact {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone }
}

function toLoan(row: LoanRow): PipelineLoan {
  const primary = row.borrowers.find((b) => b.role === 'primary')?.contact ?? null
  return {
    id: row.id,
    purpose: row.purpose,
    stage: row.stage,
    lostReason: row.lost_reason,
    referralSource: row.referral_source,
    stageChangedAt: row.stage_changed_at,
    createdAt: row.created_at,
    priorLoanId: row.prior_loan_id,
    assignedLo: row.assigned_lo
      ? { id: row.assigned_lo.id, name: row.assigned_lo.full_name || row.assigned_lo.email }
      : null,
    borrower: primary ? toContact(primary) : null,
    coBorrowerCount: row.borrowers.filter((b) => b.role === 'co_borrower').length,
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every loan the signed-in user is allowed to see (Row Level Security filters it). */
export function usePipeline() {
  return useQuery({
    queryKey: keys.pipeline,
    queryFn: async () => {
      const rows = unwrap<LoanRow[]>(
        await db().from('loans').select(LOAN_SELECT).order('stage_changed_at', { ascending: false }),
      )
      return rows.map(toLoan)
    },
  })
}

function toProfile(row: LoanProfileRow): LoanProfile {
  const details = Object.fromEntries(
    Object.entries(DETAIL_COLUMNS).map(([key, [column, numeric]]) => [key, numeric ? num(row[column]) : (row[column] ?? null)]),
  ) as unknown as LoanDetails
  return { ...toLoan(row), organizationId: row.organization_id, details }
}

/** One loan with its deal details, for the borrower profile. */
export function useLoan(id: string) {
  return useQuery({
    queryKey: keys.loan(id),
    queryFn: async () => {
      const row = unwrap<LoanProfileRow | null>(await db().from('loans').select(PROFILE_SELECT).eq('id', id).maybeSingle())
      return row ? toProfile(row) : null
    },
  })
}

/** All loans for one person, newest first (repeat and refi business). */
export function useContactLoans(contactId: string | undefined) {
  return useQuery({
    queryKey: keys.contactLoans(contactId ?? ''),
    enabled: !!contactId,
    queryFn: async () => {
      const rows = unwrap<LoanRow[]>(
        await db()
          .from('loans')
          .select(LOAN_SELECT.replace('borrowers:loan_borrowers (', 'borrowers:loan_borrowers!inner ('))
          .eq('borrowers.contact_id', contactId!)
          .order('created_at', { ascending: false }),
      )
      return rows.map(toLoan)
    },
  })
}

interface HistoryRow {
  id: number
  from_stage: PipelineStage | null
  to_stage: PipelineStage
  lost_reason: string | null
  changed_at: string
  changed_by: { id: string; full_name: string | null; email: string } | null
}

export function useStageHistory(loanId: string) {
  return useQuery({
    queryKey: keys.stageHistory(loanId),
    queryFn: async () => {
      const rows = unwrap<HistoryRow[]>(
        await db()
          .from('loan_stage_history')
          .select('id, from_stage, to_stage, lost_reason, changed_at, changed_by:profiles!loan_stage_history_changed_by_fkey ( id, full_name, email )')
          .eq('loan_id', loanId)
          .order('changed_at', { ascending: false })
          .order('id', { ascending: false }),
      )
      return rows.map(
        (r): StageHistoryEntry => ({
          id: r.id,
          fromStage: r.from_stage,
          toStage: r.to_stage,
          lostReason: r.lost_reason,
          changedAt: r.changed_at,
          changedBy: r.changed_by ? { id: r.changed_by.id, name: r.changed_by.full_name || r.changed_by.email } : null,
        }),
      )
    },
  })
}

/** People in the signed-in user's organization, for "Assigned LO" pickers and filters. */
export function useOrgMembers() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: keys.orgMembers,
    enabled: !!orgId,
    queryFn: async () => {
      const rows = unwrap<{ role: OrgMember['role']; profile: { id: string; full_name: string | null; email: string } | null }[]>(
        await db()
          .from('organization_members')
          .select('role, profile:profiles ( id, full_name, email )')
          .eq('organization_id', orgId!),
      )
      return rows
        .filter((r) => r.profile)
        .map((r): OrgMember => ({
          id: r.profile!.id,
          name: r.profile!.full_name || r.profile!.email,
          email: r.profile!.email,
          role: r.role,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface NewLeadInput {
  firstName: string
  lastName: string
  email: string
  phone: string
  purpose: LoanPurpose
  referralSource: string
  assignedLoId: string | null
  /** Set when adding a new loan to someone already in LOSuite. */
  existingContactId: string | null
  priorLoanId: string | null
}

/** Creates the person (or reuses one), the loan and the link in one database step. */
export function useCreateLead() {
  const { state } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewLeadInput) => {
      const orgId = state.status === 'signedIn' ? state.user.organizationId : null
      if (!orgId) throw new Error('Your login is not part of an organization yet. Run supabase/seed.sql.')
      return unwrap<string>(
        await db().rpc('create_lead', {
          p_organization_id: orgId,
          p_first_name: input.firstName,
          p_last_name: input.lastName,
          p_email: input.email,
          p_phone: input.phone,
          p_purpose: input.purpose,
          p_referral_source: input.referralSource,
          p_assigned_lo_id: input.assignedLoId,
          p_existing_contact_id: input.existingContactId,
          p_prior_loan_id: input.priorLoanId,
        }),
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.pipeline })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
      queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
    },
  })
}

export interface StageChange {
  loanId: string
  stage: PipelineStage
  lostReason?: string
}

/**
 * Moves a loan to a new stage. The board updates instantly and rolls back if
 * the save fails. The database logs the change in loan_stage_history itself.
 */
export function useUpdateStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ loanId, stage, lostReason }: StageChange) => {
      const rows = unwrap<{ id: string }[]>(
        await db()
          .from('loans')
          .update({ stage, lost_reason: stage === 'lost' ? lostReason ?? null : null })
          .eq('id', loanId)
          .select('id'),
      )
      if (rows.length === 0) throw new Error('You do not have permission to change this loan.')
    },
    onMutate: async ({ loanId, stage, lostReason }) => {
      await queryClient.cancelQueries({ queryKey: keys.pipeline })
      const previous = queryClient.getQueryData<PipelineLoan[]>(keys.pipeline)
      queryClient.setQueryData<PipelineLoan[]>(keys.pipeline, (loans) =>
        loans?.map((l) =>
          l.id === loanId
            ? { ...l, stage, lostReason: stage === 'lost' ? lostReason ?? null : null, stageChangedAt: new Date().toISOString() }
            : l,
        ),
      )
      return { previous }
    },
    onError: (_error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(keys.pipeline, context.previous)
    },
    onSettled: (_data, _error, { loanId }) => {
      queryClient.invalidateQueries({ queryKey: keys.pipeline })
      queryClient.invalidateQueries({ queryKey: keys.loan(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.stageHistory(loanId) })
      queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
    },
  })
}

export interface LeadEdits {
  loanId: string
  contactId: string
  contact: Pick<Contact, 'firstName' | 'lastName' | 'email' | 'phone'>
  loan: { purpose: LoanPurpose; referralSource: string | null; assignedLoId: string | null; ariveLoanNumber?: string | null }
}

/** Saves edits to the person and the loan from the record page. */
export function useUpdateLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ loanId, contactId, contact, loan }: LeadEdits) => {
      const contactRows = unwrap<{ id: string }[]>(
        await db()
          .from('contacts')
          .update({
            first_name: contact.firstName.trim(),
            last_name: contact.lastName.trim(),
            email: contact.email?.trim() || null,
            phone: contact.phone?.trim() || null,
          })
          .eq('id', contactId)
          .select('id'),
      )
      const loanRows = unwrap<{ id: string }[]>(
        await db()
          .from('loans')
          .update({
            purpose: loan.purpose,
            referral_source: loan.referralSource?.trim() || null,
            assigned_lo_id: loan.assignedLoId,
            ...(loan.ariveLoanNumber !== undefined ? { arive_loan_number: loan.ariveLoanNumber?.trim() || null } : {}),
          })
          .eq('id', loanId)
          .select('id'),
      )
      if (contactRows.length === 0 || loanRows.length === 0) {
        throw new Error('You do not have permission to edit this record.')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.pipeline })
      queryClient.invalidateQueries({ queryKey: ['loan'] })
      queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
    },
  })
}

/** Saves any of the loan's deal details. Every screen that edits these values goes through here. */
/** Writes deal details to the loan row (shared by the save hook and MISMO import). */
export async function saveLoanDetails(loanId: string, changes: Partial<LoanDetails>): Promise<void> {
  const row = Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [DETAIL_COLUMNS[key as keyof LoanDetails][0], value === '' ? null : value]),
  )
  if (Object.keys(row).length === 0) return
  const rows = unwrap<{ id: string }[]>(await db().from('loans').update(row).eq('id', loanId).select('id'))
  if (rows.length === 0) throw new Error('You do not have permission to edit this loan.')
}

export function useUpdateLoanDetails(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: Partial<LoanDetails>) => saveLoanDetails(loanId, changes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.loan(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.pipeline })
    },
  })
}
