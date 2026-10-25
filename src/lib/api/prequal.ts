import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PrequalChanges, QuickJob } from '@/lib/prequal/draft'
import { db, keys, unwrap } from './client'
import { saveLoanDetails } from './loans'

/** A job's main figure goes to self-employed income or base pay. */
const jobIncome = (j: QuickJob) => (j.selfEmployed ? { self_employed_income: j.monthly } : { base_income: j.monthly })

async function run(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const result = await query
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
}

/**
 * Saves the prequal into the same records the 1003 uses: the loan, each
 * borrower's score, jobs, other income, debts and savings. Only what
 * changed is written.
 */
export function useSavePrequal(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (c: PrequalChanges) => {
      await saveLoanDetails(loanId, c.loan)
      for (const s of c.scores) {
        const rows = unwrap<{ contact_id: string }[]>(
          await db().from('loan_borrowers').update({ estimated_credit_score: s.creditScore }).eq('loan_id', loanId).eq('contact_id', s.contactId).select('contact_id'),
        )
        if (rows.length === 0) throw new Error('You do not have permission to edit this loan.')
      }

      for (const j of c.jobs.insert) {
        await run('Adding a job', db().from('employments').insert({ organization_id: organizationId, contact_id: j.contactId, employer_name: j.employerName.trim(), status: 'current', is_self_employed: j.selfEmployed, ...jobIncome(j) }).select('id'))
      }
      for (const j of c.jobs.update) {
        await run('Saving a job', db().from('employments').update({ employer_name: j.employerName.trim() || 'Employer', ...jobIncome(j) }).eq('id', j.id!).select('id'))
      }
      if (c.jobs.remove.length) await run('Removing a job', db().from('employments').delete().in('id', c.jobs.remove))

      for (const i of c.otherIncomes.insert) {
        await run('Adding other income', db().from('other_incomes').insert({ organization_id: organizationId, contact_id: i.contactId, income_type: i.incomeType, monthly_amount: i.monthly ?? 0 }).select('id'))
      }
      for (const i of c.otherIncomes.update) {
        await run('Saving other income', db().from('other_incomes').update({ income_type: i.incomeType, monthly_amount: i.monthly ?? 0 }).eq('id', i.id!).select('id'))
      }
      if (c.otherIncomes.remove.length) await run('Removing other income', db().from('other_incomes').delete().in('id', c.otherIncomes.remove))

      for (const d of c.debts.insert) {
        await run('Adding a debt', db().from('liabilities').insert({ loan_id: loanId, contact_id: d.contactId, liability_type: d.liabilityType, creditor_name: d.creditorName.trim() || null, monthly_payment: d.monthlyPayment ?? 0, to_be_paid_off: d.toBePaidOff, unpaid_balance: d.unpaidBalance }).select('id'))
      }
      for (const d of c.debts.update) {
        await run('Saving a debt', db().from('liabilities').update({ contact_id: d.contactId, liability_type: d.liabilityType, creditor_name: d.creditorName.trim() || null, monthly_payment: d.monthlyPayment ?? 0, to_be_paid_off: d.toBePaidOff, unpaid_balance: d.unpaidBalance }).eq('id', d.id!).select('id'))
      }
      if (c.debts.remove.length) await run('Removing a debt', db().from('liabilities').delete().in('id', c.debts.remove))

      for (const a of c.assets.insert) {
        await run('Adding savings', db().from('assets').insert({ loan_id: loanId, contact_id: a.contactId, asset_type: a.assetType, institution_name: a.institutionName.trim() || null, amount: a.amount ?? 0, use_as: a.useAs }).select('id'))
      }
      for (const a of c.assets.update) {
        await run('Saving savings', db().from('assets').update({ contact_id: a.contactId, asset_type: a.assetType, institution_name: a.institutionName.trim() || null, amount: a.amount ?? 0, use_as: a.useAs }).eq('id', a.id!).select('id'))
      }
      if (c.assets.remove.length) await run('Removing savings', db().from('assets').delete().in('id', c.assets.remove))

      // Keep and rent stay retained (keep has no rent); sell marks the home pending sale.
      for (const h of c.properties) {
        await run('Saving a home', db().from('properties').update({ reo_disposition: h.plan === 'sell' ? 'pending_sale' : 'retain', monthly_rent: h.plan === 'keep' ? null : h.monthlyRent, estimated_value: h.estimatedValue, ...(h.plan === 'keep' ? { rental_income_method: 'lease' } : {}) }).eq('id', h.id).select('id'))
      }
    },
    // Refresh even after a partial failure, so the screen shows what actually saved.
    onSettled: () => {
      for (const key of [keys.loan(loanId), keys.application(loanId), keys.properties(loanId), keys.pipeline]) queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
