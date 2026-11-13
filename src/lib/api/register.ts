import { useQuery } from '@tanstack/react-query'
import type { CompSnapshot } from '@/lib/calc/loanComp'
import type { RegisterLoan } from '@/lib/closed/register'
import { db, num, unwrap } from './client'

interface Row {
  id: string
  closing_date: string | null
  funding_date: string | null
  stage_changed_at: string
  purpose: string
  occupancy: string | null
  loan_amount: unknown
  note_rate: unknown
  term_months: number | null
  arive_loan_number: string | null
  lead_source_type: 'company' | 'self' | null
  revenue_type: 'percent' | 'amount' | null
  revenue_value: unknown
  comp_plan_id: string | null
  comp_base_mode: CompSnapshot['baseMode'] | null
  comp_base_bps: unknown
  comp_split_pct: unknown
  comp_member_type: CompSnapshot['memberType'] | null
  review_status: RegisterLoan['reviewStatus']
  lender_name: string | null
  program_name: string | null
  assigned_lo_id: string | null
  program: { id: string; name: string; lender: { id: string; name: string } | null } | null
  lo: { full_name: string | null; email: string } | null
  borrowers: { role: string; contact: { first_name: string; last_name: string } | null }[]
  home: { address_line: string; city: string | null } | null
}

const SELECT = `id, closing_date, funding_date, stage_changed_at, purpose, occupancy, loan_amount, note_rate, term_months, arive_loan_number,
  lead_source_type, revenue_type, revenue_value, comp_plan_id, comp_base_mode, comp_base_bps, comp_split_pct, comp_member_type, review_status,
  lender_name, program_name, assigned_lo_id,
  program:programs!loans_program_id_fkey ( id, name, lender:lenders ( id, name ) ),
  lo:profiles!loans_assigned_lo_id_fkey ( full_name, email ),
  borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name ) ),
  home:properties!loans_subject_property_id_fkey ( address_line, city )`

/**
 * Every closed loan the user can see, for the register: admins see every
 * loan, a loan officer only their own (the file rule). Lenders typed by name
 * are matched to the Lenders page by name, for the comp plan check.
 */
export function useRegisterLoans(lenders: { id: string; name: string }[] | undefined) {
  return useQuery({
    queryKey: ['register', lenders?.length ?? 0],
    enabled: !!lenders,
    queryFn: async (): Promise<RegisterLoan[]> => {
      const rows = unwrap<Row[]>(await db().from('loans').select(SELECT).eq('stage', 'closed').limit(5000))
      // Commission confirmation (read on its own, so the register works before that script has run).
      const conf = await db().from('loans').select('id, comp_confirmed_at, comp_paid_on').eq('stage', 'closed').limit(5000)
      const confirmed = new Map(((conf.error ? [] : conf.data) as { id: string; comp_confirmed_at: string | null; comp_paid_on: string | null }[]).map((c) => [c.id, c]))
      return rows.map((r) => {
        const people = r.borrowers.filter((b) => b.contact)
        const primary = (people.find((b) => b.role === 'primary') ?? people[0])?.contact
        const typed = r.lender_name?.trim().toLowerCase()
        const lender = r.program?.lender ?? (typed ? (lenders!.find((l) => l.name.toLowerCase() === typed) ?? null) : null)
        const split = num(r.comp_split_pct)
        return {
          id: r.id,
          closingDate: r.closing_date,
          fundingDate: r.funding_date,
          stageChangedAt: r.stage_changed_at,
          borrower: primary ? `${primary.first_name} ${primary.last_name}`.trim() : 'No borrower',
          property: r.home ? [r.home.address_line, r.home.city].filter(Boolean).join(', ') : null,
          loId: r.assigned_lo_id,
          loName: r.lo ? r.lo.full_name || r.lo.email : null,
          lenderId: lender?.id ?? null,
          lender: lender?.name ?? r.lender_name,
          programId: r.program?.id ?? null,
          program: r.program?.name ?? r.program_name,
          purpose: r.purpose,
          occupancy: r.occupancy,
          loanAmount: num(r.loan_amount),
          rate: num(r.note_rate),
          termMonths: r.term_months,
          ariveLoanNumber: r.arive_loan_number,
          leadSourceType: r.lead_source_type,
          revenueType: r.revenue_type,
          revenueValue: num(r.revenue_value),
          compPlanId: r.comp_plan_id,
          reviewStatus: r.review_status ?? null,
          snapshot: r.comp_base_mode && split != null ? { baseMode: r.comp_base_mode, baseBps: num(r.comp_base_bps), splitPct: split, memberType: r.comp_member_type ?? 'commission' } : null,
          compConfirmedAt: confirmed.get(r.id)?.comp_confirmed_at ?? null,
          compPaidOn: confirmed.get(r.id)?.comp_paid_on ?? null,
        }
      })
    },
  })
}
