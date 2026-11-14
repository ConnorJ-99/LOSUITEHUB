// A loan's numbers (lender loan #, Arive #, title GF #), its picked lender and
// its mortgagee clause override. Read with `*` on their own, so the loan page
// works before the loan numbers script has run (then `ready` is false and
// nothing is required).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cleanNumber, type LoanNumbers } from '@/lib/loans/numbers'
import { db, keys, unwrap } from './client'

export const loanNumbersKey = (loanId: string) => ['loan-numbers', loanId] as const
export const loanNumberIndexKey = ['loan-number-index'] as const

interface Row {
  arive_loan_number: string | null
  lender_name: string | null
  lender_id?: string | null
  lender_loan_number?: string | null
  title_file_number?: string | null
  mortgagee_clause_override?: string | null
  program?: { lender_id: string } | null
}

const toNumbers = (r: Row): LoanNumbers => ({
  ready: r.lender_loan_number !== undefined,
  programLenderId: r.program?.lender_id ?? null,
  lenderId: r.lender_id ?? null,
  lenderNameTyped: r.lender_name,
  lenderLoanNumber: r.lender_loan_number ?? null,
  ariveLoanNumber: r.arive_loan_number,
  titleFileNumber: r.title_file_number ?? null,
  mortgageeClauseOverride: r.mortgagee_clause_override ?? null,
})

export async function fetchLoanNumbers(loanId: string): Promise<LoanNumbers> {
  const r = unwrap<Row | null>(await db().from('loans').select('*, program:programs!loans_program_id_fkey ( lender_id )').eq('id', loanId).maybeSingle())
  if (!r) throw new Error('Loan not found')
  return toNumbers(r)
}

export function useLoanNumbers(loanId: string) {
  return useQuery({ queryKey: loanNumbersKey(loanId), queryFn: () => fetchLoanNumbers(loanId) })
}

export type LoanNumberChanges = Partial<Pick<LoanNumbers, 'lenderId' | 'lenderLoanNumber' | 'ariveLoanNumber' | 'titleFileNumber' | 'mortgageeClauseOverride'>>

export async function saveLoanNumbers(loanId: string, c: LoanNumberChanges): Promise<void> {
  const row = {
    ...(c.lenderId !== undefined && { lender_id: c.lenderId }),
    ...(c.lenderLoanNumber !== undefined && { lender_loan_number: cleanNumber(c.lenderLoanNumber) }),
    ...(c.ariveLoanNumber !== undefined && { arive_loan_number: cleanNumber(c.ariveLoanNumber) }),
    ...(c.titleFileNumber !== undefined && { title_file_number: cleanNumber(c.titleFileNumber) }),
    ...(c.mortgageeClauseOverride !== undefined && { mortgagee_clause_override: c.mortgageeClauseOverride?.trim() || null }),
  }
  if (Object.keys(row).length === 0) return
  const rows = unwrap<{ id: string }[]>(await db().from('loans').update(row).eq('id', loanId).select('id'))
  if (rows.length === 0) throw new Error('You do not have permission to edit this loan.')
}

export function useSaveLoanNumbers(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (c: LoanNumberChanges) => saveLoanNumbers(loanId, c),
    onSuccess: () => {
      for (const k of [loanNumbersKey(loanId), keys.loan(loanId), keys.pipeline, loanNumberIndexKey]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

/** Every visible file's numbers and borrowers, for search on the boards and Contacts. */
export function useLoanNumberIndex() {
  return useQuery({
    queryKey: loanNumberIndexKey,
    queryFn: async () => {
      const rows = unwrap<(Row & { id: string; borrowers: { contact_id: string }[] })[]>(await db().from('loans').select('*, borrowers:loan_borrowers ( contact_id )'))
      const byLoan = new Map<string, string[]>()
      const byContact = new Map<string, string[]>()
      for (const r of rows) {
        const nums = [r.arive_loan_number, r.lender_loan_number ?? null, r.title_file_number ?? null].filter((x): x is string => !!x)
        byLoan.set(r.id, nums)
        for (const b of r.borrowers) byContact.set(b.contact_id, [...(byContact.get(b.contact_id) ?? []), ...nums])
      }
      return { byLoan, byContact }
    },
  })
}
