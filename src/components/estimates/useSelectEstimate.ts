import { useQueryClient } from '@tanstack/react-query'
import { db, keys, unwrap } from '@/lib/api/client'
import { saveLoanDetails } from '@/lib/api/loans'
import { useSaveProperty, type PropertyInput } from '@/lib/api/properties'
import type { LoanProfile, Property } from '@/lib/api/types'
import { nowIso } from '@/lib/dates'
import { round } from '@/lib/calc'
import { MORTGAGE_TYPE_FOR_FAMILY, computeEstimate, estimateLender, estimateProgramName, pricingDraft, selectedNote, type Estimate } from '@/lib/estimates/estimate'
import { loanChangesFrom } from '@/lib/pricing/scenario'
import type { EstimateData } from './useEstimateData'
import { draftOf } from './useEstimateData'

/** Everything about a home except what pricing doesn't touch, for saving it back. */
function propertyInput(p: Property): PropertyInput {
  const { id: _id, loanId: _loan, createdAt: _created, liens: _liens, rentalIncomeMethod: _method, scheduleEMonthlyIncome: _e, ...input } = p
  return input
}

/**
 * "Select for this file": writes the estimate's program, lender, rate,
 * points, loan amount, credits and fee estimates to the loan (and taxes,
 * insurance and HOA to its home), makes it the Selected estimate (the one
 * before goes back to Draft) and logs it on the file.
 */
export function useSelectEstimate(loan: LoanProfile, data: EstimateData) {
  const queryClient = useQueryClient()
  const saveProperty = useSaveProperty(loan.id, loan.organizationId)
  return async (e: Estimate) => {
    const draft = draftOf(e)
    const facts = e.loanSnapshot?.facts ?? data.factsFor(e.propertyId)
    const r = computeEstimate(draft, data.feesOf(e.id), data.templates, facts)
    const at = { ...pricingDraft(draft), id: e.id }
    const points = r.priced.lines.find((l) => l.key === 'points')?.atClosing ?? 0
    const prepaids = round(r.priced.totals.F + r.priced.totals.G)
    const c = loanChangesFrom(at, loan.purpose, r.saved.closingCosts, prepaids)
    const mortgageType = e.program ? MORTGAGE_TYPE_FOR_FAMILY[e.program.family] : undefined
    await saveLoanDetails(loan.id, {
      ...c.loan,
      // The 1003 lists points apart from the other closing costs.
      estimatedClosingCosts: round(r.saved.closingCosts - prepaids - points) || null,
      ...(mortgageType && { mortgageType }),
      programId: e.program?.programId ?? null,
      chosenQuoteId: null,
      lenderName: estimateLender(e) ?? null,
      programName: estimateProgramName(e) ?? null,
      ...(e.sellerCredits != null && { sellerCredits: e.sellerCredits }),
      pricingScenarioId: e.id,
    })
    const home = data.properties.find((p) => p.id === e.propertyId)
    if (c.property && home) await saveProperty.mutateAsync({ ...propertyInput(home), ...c.property, id: home.id })
    if (loan.borrower) {
      unwrap(await db().from('notes').insert({ organization_id: loan.organizationId, contact_id: loan.borrower.id, loan_id: loan.id, kind: 'note', body: selectedNote(e, nowIso()) }).select('id'))
      queryClient.invalidateQueries({ queryKey: keys.notes(loan.borrower.id) })
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.loan(loan.id) }),
      queryClient.invalidateQueries({ queryKey: keys.loanFile(loan.id) }),
      queryClient.invalidateQueries({ queryKey: keys.pipeline }),
      data.refresh(),
    ])
  }
}
