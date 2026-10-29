import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import type { ImportRow, RowResult } from '@/lib/import/clients'
import type { LoanPurpose } from '@/lib/pipeline/stages'
import { db, keys, num, unwrap } from './client'
import { reassignLoan, saveLoanDetails } from './loans'
import type { MemberRef, MortgageType, Occupancy } from './types'

// ---------------------------------------------------------------------------
// Closed loans (the Closed list and the closed loan profile)
// ---------------------------------------------------------------------------

export interface ClosedPerson {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  birthday: string | null
  smsConsent: boolean | null
  emailConsent: boolean | null
}

export interface ClosedHome {
  id: string
  addressLine: string
  city: string | null
  state: string
  zip: string | null
  estimatedValue: number | null
  insuranceCarrier: string | null
  insuranceRenewalDate: string | null
  homesteadFiled: boolean | null
}

export interface ClosedLoan {
  id: string
  purpose: LoanPurpose
  loanType: MortgageType | null
  occupancy: Occupancy
  closingDate: string | null
  firstPaymentDate: string | null
  loanAmount: number | null
  purchasePrice: number | null
  rate: number | null
  termMonths: number | null
  monthlyPayment: number | null
  /** The chosen Product Search program's lender, else the typed lender. */
  lender: string | null
  program: string | null
  lenderName: string | null
  programName: string | null
  lo: MemberRef | null
  borrower: ClosedPerson | null
  coBorrowers: ClosedPerson[]
  home: ClosedHome | null
}

interface PersonRow {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  date_of_birth: string | null
  sms_consent: boolean | null
  email_consent: boolean | null
}

interface ClosedRow {
  id: string
  purpose: LoanPurpose
  mortgage_type: MortgageType | null
  occupancy: Occupancy
  closing_date: string | null
  first_payment_date: string | null
  loan_amount: unknown
  purchase_price: unknown
  note_rate: unknown
  term_months: number | null
  monthly_payment: unknown
  lender_name: string | null
  program_name: string | null
  program: { name: string; lender: { name: string } | null } | null
  lo: { id: string; full_name: string | null; email: string } | null
  borrowers: { role: 'primary' | 'co_borrower'; contact: PersonRow | null }[]
  home: {
    id: string
    address_line: string
    city: string | null
    state: string
    zip: string | null
    estimated_value: unknown
    insurance_carrier: string | null
    insurance_renewal_date: string | null
    homestead_filed: boolean | null
  } | null
}

const CLOSED_SELECT = `
  id, purpose, mortgage_type, occupancy, closing_date, first_payment_date, loan_amount, purchase_price, note_rate, term_months,
  monthly_payment, lender_name, program_name,
  program:programs!loans_program_id_fkey ( name, lender:lenders ( name ) ),
  lo:profiles!loans_assigned_lo_id_fkey ( id, full_name, email ),
  borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( id, first_name, last_name, email, phone, date_of_birth, sms_consent, email_consent ) ),
  home:properties!loans_subject_property_id_fkey ( id, address_line, city, state, zip, estimated_value, insurance_carrier, insurance_renewal_date, homestead_filed )
`

const toPerson = (r: PersonRow): ClosedPerson => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  email: r.email,
  phone: r.phone,
  birthday: r.date_of_birth,
  smsConsent: r.sms_consent,
  emailConsent: r.email_consent,
})

function toClosed(r: ClosedRow): ClosedLoan {
  const people = r.borrowers.filter((b) => b.contact)
  const primary = people.find((b) => b.role === 'primary')?.contact
  return {
    id: r.id,
    purpose: r.purpose,
    loanType: r.mortgage_type,
    occupancy: r.occupancy,
    closingDate: r.closing_date,
    firstPaymentDate: r.first_payment_date,
    loanAmount: num(r.loan_amount),
    purchasePrice: num(r.purchase_price),
    rate: num(r.note_rate),
    termMonths: r.term_months,
    monthlyPayment: num(r.monthly_payment),
    lender: r.program?.lender?.name ?? r.lender_name,
    program: r.program?.name ?? r.program_name,
    lenderName: r.lender_name,
    programName: r.program_name,
    lo: r.lo ? { id: r.lo.id, name: r.lo.full_name || r.lo.email } : null,
    borrower: primary ? toPerson(primary) : null,
    coBorrowers: people.filter((b) => b.role === 'co_borrower').map((b) => toPerson(b.contact!)),
    home: r.home
      ? {
          id: r.home.id,
          addressLine: r.home.address_line,
          city: r.home.city,
          state: r.home.state,
          zip: r.home.zip,
          estimatedValue: num(r.home.estimated_value),
          insuranceCarrier: r.home.insurance_carrier,
          insuranceRenewalDate: r.home.insurance_renewal_date,
          homesteadFiled: r.home.homestead_filed,
        }
      : null,
  }
}

/** Every closed loan the user can see (their own; every one for an admin), newest closing first. */
export function useClosedLoans() {
  return useQuery({
    queryKey: keys.closedLoans,
    queryFn: async () => {
      const rows = unwrap<ClosedRow[]>(
        await db().from('loans').select(CLOSED_SELECT).eq('stage', 'closed').order('closing_date', { ascending: false, nullsFirst: false }),
      )
      return rows.map(toClosed)
    },
  })
}

/** One file's closed loan facts (the profile's Closed loan card). */
export function useClosedLoan(loanId: string) {
  return useQuery({
    queryKey: [...keys.closedLoans, loanId],
    queryFn: async () => {
      const row = unwrap<ClosedRow | null>(await db().from('loans').select(CLOSED_SELECT).eq('id', loanId).maybeSingle())
      return row ? toClosed(row) : null
    },
  })
}

export interface ClosedFactsInput {
  loan: { lenderName: string | null; programName: string | null; monthlyPayment: number | null }
  home: { id: string; insuranceCarrier: string | null; insuranceRenewalDate: string | null; homesteadFiled: boolean | null } | null
  person: { id: string; smsConsent: boolean | null; emailConsent: boolean | null } | null
}

/** Saves the closed loan card: each value to its own place (loan, home, person). */
export function useSaveClosedFacts(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ loan, home, person }: ClosedFactsInput) => {
      await saveLoanDetails(loanId, loan)
      if (home) {
        unwrap(
          await db()
            .from('properties')
            .update({ insurance_carrier: home.insuranceCarrier?.trim() || null, insurance_renewal_date: home.insuranceRenewalDate || null, homestead_filed: home.homesteadFiled })
            .eq('id', home.id)
            .select('id'),
        )
      }
      if (person) {
        unwrap(await db().from('contacts').update({ sms_consent: person.smsConsent, email_consent: person.emailConsent }).eq('id', person.id).select('id'))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.closedLoans })
      queryClient.invalidateQueries({ queryKey: keys.loan(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.properties(loanId) })
    },
  })
}

/** Makes a follow-up task from a key date, once (tasks.source_key). */
export function useAddFollowUp(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { title: string; dueOn: string; sourceKey: string }) => {
      unwrap(
        await db()
          .from('tasks')
          .upsert(
            { organization_id: organizationId, loan_id: loanId, title: input.title, due_on: input.dueOn, source_key: input.sourceKey },
            { onConflict: 'loan_id,source_key', ignoreDuplicates: true },
          )
          .select('id'),
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.loanTasks(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.myTasks })
      queryClient.invalidateQueries({ queryKey: keys.openTasks })
    },
  })
}

export interface CopyToLeadInput {
  closed: ClosedLoan
  organizationId: string
  purpose: LoanPurpose
  /** Bring the co-borrowers onto the new file. */
  withCoBorrowers: boolean
  /** Copy the home, with this loan as its current mortgage (estimated balance today). */
  withHome: boolean
  /** The closed loan's estimated balance and P&I payment today, from the amortization. */
  currentLien: { balance: number | null; monthlyPayment: number | null }
}

/** Columns of a home that copy to the new file (not its id, file or timestamps). */
const HOME_COPY = 'address_line, city, state, zip, county, property_type, estimated_value, annual_taxes, annual_insurance, monthly_hoa, monthly_rent, is_homestead, unit_count, insurance_carrier, insurance_renewal_date, homestead_filed'

/**
 * Starts the client's next loan from a closed file. The person stays one
 * record (their addresses, jobs and income come along because they belong to
 * the person); the new file links back to this one. For a refinance or HELOC
 * the home becomes the new file's subject property with this loan as its
 * first lien; for a purchase it is their current home.
 */
export function useCopyToNewLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ closed: c, organizationId, purpose, withCoBorrowers, withHome, currentLien }: CopyToLeadInput) => {
      if (!c.borrower) throw new Error('This file has no borrower to copy.')
      // Made as yours so everything can be added, then handed to the file's loan officer.
      const loanId = unwrap<string>(
        await db().rpc('create_lead', {
          p_organization_id: organizationId,
          p_first_name: c.borrower.firstName,
          p_last_name: c.borrower.lastName,
          p_email: c.borrower.email ?? '',
          p_phone: c.borrower.phone ?? '',
          p_purpose: purpose,
          p_referral_source: 'Past client',
          p_assigned_lo_id: null,
          p_existing_contact_id: c.borrower.id,
          p_prior_loan_id: c.id,
        }),
      )
      if (withCoBorrowers && c.coBorrowers.length) {
        unwrap(await db().from('loan_borrowers').insert(c.coBorrowers.map((p) => ({ loan_id: loanId, contact_id: p.id, organization_id: organizationId, role: 'co_borrower' }))))
      }
      const refi = purpose !== 'purchase'
      if (withHome && c.home) {
        const home = unwrap<Record<string, unknown>>(await db().from('properties').select(HOME_COPY).eq('id', c.home.id).single())
        const copy = unwrap<{ id: string }>(
          await db().from('properties').insert({ ...home, organization_id: organizationId, loan_id: loanId, status: 'current_home' }).select('id').single(),
        )
        unwrap(
          await db().from('property_liens').insert({
            organization_id: organizationId,
            property_id: copy.id,
            position: 'first',
            lender: c.lender,
            balance: currentLien.balance,
            note_rate: c.rate,
            monthly_payment: currentLien.monthlyPayment,
            originated_on: c.closingDate,
            mortgage_type: c.loanType,
            is_texas_cash_out: c.purpose === 'refinance_cash_out' && c.home.state === 'TX' && c.occupancy === 'primary',
          }),
        )
        if (refi) await saveLoanDetails(loanId, { subjectPropertyId: copy.id, occupancy: c.occupancy })
      }
      if (c.lo && c.lo.id) await reassignLoan(loanId, c.lo.id)
      return loanId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.pipeline })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
      queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Bulk import and deleting a file
// ---------------------------------------------------------------------------

/** Rows per database call, so a large file stays well under the request time limit. */
const BATCH = 150

/**
 * Sends checked rows to import_clients(). With save = false it is a preview:
 * the database matches and writes, then undoes everything, so the answer is
 * what saving would do.
 */
export function useImportClients() {
  const { state } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ rows, save, onProgress }: { rows: ImportRow[]; save: boolean; onProgress?: (done: number) => void }) => {
      const orgId = state.status === 'signedIn' ? state.user.organizationId : null
      if (!orgId) throw new Error('Your login is not part of a company yet.')
      const results: RowResult[] = []
      for (let i = 0; i < rows.length; i += BATCH) {
        results.push(...unwrap<RowResult[]>(await db().rpc('import_clients', { p_org: orgId, p_rows: rows.slice(i, i + BATCH), p_save: save })))
        onProgress?.(Math.min(i + BATCH, rows.length))
      }
      return results
    },
    onSuccess: (_results, { save }) => {
      if (!save) return
      queryClient.invalidateQueries({ queryKey: keys.pipeline })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
      queryClient.invalidateQueries({ queryKey: keys.closedLoans })
      queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
    },
  })
}

/**
 * Deletes a file and the people on it who have no other file. Its loan
 * officer or an admin only. The file's uploads (contracts, documents, PDFs)
 * are removed from storage first, while the file can still be seen.
 */
export function useDeleteLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ loanId, organizationId }: { loanId: string; organizationId: string }) => {
      const folder = `${organizationId}/${loanId}`
      const listed = await db().storage.from('loan-files').list(folder, { limit: 1000 })
      if (listed.error) throw new Error(listed.error.message)
      const paths = (listed.data ?? []).map((f) => `${folder}/${f.name}`)
      if (paths.length) {
        const removed = await db().storage.from('loan-files').remove(paths)
        if (removed.error) throw new Error(removed.error.message)
      }
      unwrap(await db().rpc('delete_lead', { p_loan_id: loanId }))
    },
    onSuccess: (_data, { loanId }) => {
      queryClient.removeQueries({ queryKey: keys.loan(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.pipeline })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
      queryClient.invalidateQueries({ queryKey: keys.closedLoans })
      queryClient.invalidateQueries({ queryKey: keys.openTasks })
      queryClient.invalidateQueries({ queryKey: keys.today })
      queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
    },
  })
}
